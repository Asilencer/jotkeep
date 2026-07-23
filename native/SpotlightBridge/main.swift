import AppKit
import CoreSpotlight
import UniformTypeIdentifiers

private let domainIdentifier = "notedown.documents"
private let indexName = "NoteDownDocuments"
private let markdownType = UTType(importedAs: "net.daringfireball.markdown")

private struct SpotlightDocument: Decodable {
    let id: String
    let title: String
    let text: String
    let tags: [String]
    let path: String
    let modifiedAt: String
}

private struct SpotlightPayload: Decodable {
    let documents: [SpotlightDocument]
}

private func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let output = String(data: data, encoding: .utf8) else {
        return
    }
    print(output)
    fflush(stdout)
}

private final class SpotlightBridgeDelegate: NSObject, NSApplicationDelegate {
    private let index = CSSearchableIndex(name: indexName)
    private var activityHandled = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.prohibited)
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard let command = arguments.first else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                if !self.activityHandled { NSApp.terminate(nil) }
            }
            return
        }

        switch command {
        case "index" where arguments.count == 2:
            indexDocuments(at: arguments[1])
        case "query" where arguments.count == 2:
            queryDocuments(arguments[1])
        case "clear":
            clearIndex()
        default:
            finish(["ok": false, "error": "invalid-command"])
        }
    }

    func application(
        _ application: NSApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void
    ) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType,
              let documentID = userActivity.userInfo?[CSSearchableItemActivityIdentifier]
                as? String else {
            return false
        }
        activityHandled = true
        var target = URLComponents()
        target.scheme = "notedown"
        target.host = "open"
        target.queryItems = [URLQueryItem(name: "document", value: documentID)]
        if let url = target.url { NSWorkspace.shared.open(url) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
        return true
    }

    private func indexDocuments(at payloadPath: String) {
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: payloadPath))
            let payload = try JSONDecoder().decode(SpotlightPayload.self, from: data)
            let formatter = ISO8601DateFormatter()
            let items = payload.documents.map { document in
                let attributes = CSSearchableItemAttributeSet(contentType: markdownType)
                attributes.title = document.title
                attributes.displayName = document.title
                attributes.textContent = document.text
                attributes.contentDescription = document.text
                    .replacingOccurrences(of: "\n", with: " ")
                    .prefix(180)
                    .description
                attributes.keywords = document.tags
                attributes.contentURL = URL(fileURLWithPath: document.path)
                attributes.metadataModificationDate = formatter.date(from: document.modifiedAt)
                let item = CSSearchableItem(
                    uniqueIdentifier: document.id,
                    domainIdentifier: domainIdentifier,
                    attributeSet: attributes
                )
                item.expirationDate = .distantFuture
                return item
            }
            index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier]) { error in
                if let error {
                    self.finish(["ok": false, "error": error.localizedDescription])
                    return
                }
                self.index.indexSearchableItems(items) { error in
                    if let error {
                        self.finish(["ok": false, "error": error.localizedDescription])
                    } else {
                        self.finish(["ok": true, "count": items.count])
                    }
                }
            }
        } catch {
            finish(["ok": false, "error": error.localizedDescription])
        }
    }

    private func queryDocuments(_ term: String) {
        let escaped = term.replacingOccurrences(of: "\"", with: "\\\"")
        let context = CSSearchQueryContext()
        context.fetchAttributes = ["title", "textContent", "domainIdentifier"]
        context.filterQueries = ["domainIdentifier == \"\(domainIdentifier)\""]
        let query = CSSearchQuery(
            queryString: "title == \"*\(escaped)*\"cd || textContent == \"*\(escaped)*\"cd",
            queryContext: context
        )
        var results: [[String: Any]] = []
        query.foundItemsHandler = { items in
            results.append(contentsOf: items.map { item in
                [
                    "id": item.uniqueIdentifier,
                    "title": item.attributeSet.title ?? "",
                ]
            })
        }
        query.completionHandler = { error in
            if let error {
                self.finish(["ok": false, "error": error.localizedDescription])
            } else {
                self.finish(["ok": true, "items": results])
            }
        }
        query.start()
    }

    private func clearIndex() {
        index.deleteSearchableItems(withDomainIdentifiers: [domainIdentifier]) { error in
            if let error {
                self.finish(["ok": false, "error": error.localizedDescription])
            } else {
                self.finish(["ok": true])
            }
        }
    }

    private func finish(_ payload: [String: Any]) {
        emit(payload)
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }
}

private let application = NSApplication.shared
private let delegate = SpotlightBridgeDelegate()
application.delegate = delegate
application.run()
