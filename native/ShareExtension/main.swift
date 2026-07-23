import AppKit
import UniformTypeIdentifiers

private struct SharedFileManifest: Encodable {
    let version = 1
    let token: String
    let file: String
    let name: String
    let mimeType: String
    let capturedAt: String
}

@objc(ShareViewController)
final class ShareViewController: NSViewController {
    private let spinner = NSProgressIndicator()
    private let statusLabel = NSTextField(labelWithString: "正在发送到 Jotkeep…")
    private var didStart = false

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 280, height: 96))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 13, weight: .medium)
        statusLabel.textColor = .labelColor
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(spinner)
        container.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            spinner.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 20),
            spinner.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: spinner.trailingAnchor, constant: 10),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor,
                                                  constant: -20),
            statusLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        ])
        view = container
        preferredContentSize = container.frame.size
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard !didStart else { return }
        didStart = true
        spinner.startAnimation(nil)
        beginCapture()
    }

    private func beginCapture() {
        guard let context = extensionContext else {
            showFailure("无法读取共享内容")
            return
        }
        let providers = context.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }
        let urlType = UTType.url.identifier
        let textType = UTType.plainText.identifier
        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(urlType)
        }) {
            loadItem(from: provider, typeIdentifier: urlType)
            return
        }
        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(textType)
        }) {
            loadItem(from: provider, typeIdentifier: textType)
            return
        }
        guard let provider = providers.first(where: { sharedFileType(for: $0) != nil }) else {
            showFailure("没有可保存的内容")
            return
        }
        loadSharedFile(from: provider)
    }

    private func loadItem(from provider: NSItemProvider, typeIdentifier: String) {
        provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, error in
            DispatchQueue.main.async {
                self?.handleLoadedItem(item, error: error)
            }
        }
    }

    private func handleLoadedItem(_ item: NSSecureCoding?, error: Error?) {
        guard error == nil else {
            showFailure("无法识别共享内容")
            return
        }
        if let fileURL = localFileURL(from: item) {
            stageSharedFile(fileURL, typeIdentifier: nil, suggestedName: nil)
            return
        }
        guard let request = captureRequest(from: item) else {
            showFailure("无法识别共享内容")
            return
        }
        openCaptureRequest(request)
    }

    private func openCaptureRequest(_ request: URL) {
        extensionContext?.open(request) { [weak self] opened in
            DispatchQueue.main.async {
                guard let self else { return }
                if opened {
                    self.extensionContext?.completeRequest(returningItems: nil)
                } else {
                    self.showFailure("无法打开 Jotkeep")
                }
            }
        }
    }

    private func localFileURL(from item: NSSecureCoding?) -> URL? {
        if let url = item as? URL, url.isFileURL { return url }
        if let url = item as? NSURL, (url as URL).isFileURL { return url as URL }
        return nil
    }

    private func sharedFileType(for provider: NSItemProvider) -> String? {
        provider.registeredTypeIdentifiers.first { identifier in
            guard let type = UTType(identifier) else { return false }
            return type.conforms(to: .image) ||
                type.conforms(to: .movie) ||
                type.conforms(to: .data) ||
                type.conforms(to: .item)
        }
    }

    private func loadSharedFile(from provider: NSItemProvider) {
        guard let typeIdentifier = sharedFileType(for: provider) else {
            showFailure("无法识别共享文件")
            return
        }
        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { [weak self] url, _ in
            guard let self else { return }
            if let url {
                self.stageSharedFile(
                    url,
                    typeIdentifier: typeIdentifier,
                    suggestedName: provider.suggestedName
                )
                return
            }
            provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, _ in
                guard let data else {
                    DispatchQueue.main.async { self.showFailure("无法读取共享文件") }
                    return
                }
                self.stageSharedData(
                    data,
                    typeIdentifier: typeIdentifier,
                    suggestedName: provider.suggestedName
                )
            }
        }
    }

    private func stageSharedFile(
        _ sourceURL: URL,
        typeIdentifier: String?,
        suggestedName: String?
    ) {
        do {
            let name = sharedFileName(
                suggestedName ?? sourceURL.lastPathComponent,
                typeIdentifier: typeIdentifier
            )
            let target = try stagedFileURL(name: name)
            try FileManager.default.copyItem(at: sourceURL, to: target.fileURL)
            try finishStaging(target, name: name, typeIdentifier: typeIdentifier)
        } catch {
            DispatchQueue.main.async { self.showFailure("无法暂存共享文件") }
        }
    }

    private func stageSharedData(
        _ data: Data,
        typeIdentifier: String,
        suggestedName: String?
    ) {
        do {
            let name = sharedFileName(suggestedName ?? "共享文件", typeIdentifier: typeIdentifier)
            let target = try stagedFileURL(name: name)
            try data.write(to: target.fileURL, options: .atomic)
            try finishStaging(target, name: name, typeIdentifier: typeIdentifier)
        } catch {
            DispatchQueue.main.async { self.showFailure("无法暂存共享文件") }
        }
    }

    private func stagedFileURL(name: String) throws -> (token: String, fileURL: URL) {
        let directory = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("NoteDownShare", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let token = UUID().uuidString.lowercased()
        return (token, directory.appendingPathComponent("\(token)-\(name)"))
    }

    private func finishStaging(
        _ target: (token: String, fileURL: URL),
        name: String,
        typeIdentifier: String?
    ) throws {
        let type = typeIdentifier.flatMap(UTType.init)
            ?? UTType(filenameExtension: target.fileURL.pathExtension)
        let manifest = SharedFileManifest(
            token: target.token,
            file: target.fileURL.lastPathComponent,
            name: name,
            mimeType: type?.preferredMIMEType ?? "application/octet-stream",
            capturedAt: ISO8601DateFormatter().string(from: Date())
        )
        let manifestURL = target.fileURL
            .deletingLastPathComponent()
            .appendingPathComponent("\(target.token).json")
        try JSONEncoder().encode(manifest).write(to: manifestURL, options: .atomic)
        guard let request = requestURL(name: "file", value: target.token) else {
            throw CocoaError(.fileWriteUnknown)
        }
        DispatchQueue.main.async { self.openCaptureRequest(request) }
    }

    private func sharedFileName(_ value: String, typeIdentifier: String?) -> String {
        let fallbackExtension = typeIdentifier
            .flatMap(UTType.init)?
            .preferredFilenameExtension
        let cleaned = value
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let base = String(cleaned.prefix(120))
        if !base.isEmpty, !URL(fileURLWithPath: base).pathExtension.isEmpty { return base }
        return fallbackExtension.map { "\(base.isEmpty ? "共享文件" : base).\($0)" }
            ?? (base.isEmpty ? "共享文件" : base)
    }

    private func captureRequest(from item: NSSecureCoding?) -> URL? {
        if let url = item as? URL, let request = requestURL(name: "url", value: webURL(url)) {
            return request
        }
        if let url = item as? NSURL,
           let request = requestURL(name: "url", value: webURL(url as URL)) {
            return request
        }
        let text: String?
        if let value = item as? String {
            text = value
        } else if let value = item as? NSString {
            text = value as String
        } else if let value = item as? Data {
            text = String(data: value, encoding: .utf8)
        } else {
            text = nil
        }
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return nil }
        if let url = firstWebURL(in: text) {
            return requestURL(name: "url", value: url)
        }
        return requestURL(name: "text", value: text)
    }

    private func webURL(_ url: URL) -> String? {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url.absoluteString
    }

    private func firstWebURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = detector?.firstMatch(in: text, range: range),
              let url = match.url else { return nil }
        return webURL(url)
    }

    private func requestURL(name: String, value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = "notedown"
        components.host = "capture"
        components.queryItems = [URLQueryItem(name: name, value: value)]
        return components.url
    }

    private func showFailure(_ message: String) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.stringValue = message
        statusLabel.textColor = .secondaryLabelColor
    }
}
