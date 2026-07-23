import CoreLocation
import Foundation

enum BridgeError: LocalizedError {
    case locationDenied
    case locationRestricted
    case locationUnavailable
    case invalidCoordinates
    case invalidWeatherResponse
    case weatherServiceUnavailable(Int)

    var errorDescription: String? {
        switch self {
        case .locationDenied:
            return "Location permission was denied."
        case .locationRestricted:
            return "Location access is restricted."
        case .locationUnavailable:
            return "The current location is unavailable."
        case .invalidCoordinates:
            return "Latitude and longitude must be supplied together."
        case .invalidWeatherResponse:
            return "Open-Meteo returned an invalid weather response."
        case let .weatherServiceUnavailable(statusCode):
            return "Open-Meteo request failed with HTTP status \(statusCode)."
        }
    }
}

struct WeatherAttributionPayload: Codable {
    let serviceName: String
    let legalPageURL: String
}

struct OpenMeteoCurrent: Decodable {
    let time: TimeInterval
    let interval: Double
    let temperature2M: Double
    let relativeHumidity2M: Double
    let apparentTemperature: Double
    let isDay: Int
    let precipitation: Double
    let weatherCode: Int
    let cloudCover: Double
    let windSpeed10M: Double
}

struct OpenMeteoDaily: Decodable {
    let temperature2MMax: [Double]
    let temperature2MMin: [Double]
}

struct OpenMeteoResponse: Decodable {
    let current: OpenMeteoCurrent
    let daily: OpenMeteoDaily
}

struct WeatherSnapshotPayload: Codable {
    let source: String
    let condition: String
    let symbolName: String
    let location: String
    let temperature: Double
    let high: Double
    let low: Double
    let feelsLike: Double
    let cloudCover: Double
    let precipitationIntensity: Double
    let humidity: Double
    let windSpeed: Double
    let isDaylight: Bool
    let fetchedAt: String
    let expiresAt: String
    let latitude: Double
    let longitude: Double
    let attribution: WeatherAttributionPayload
}

struct BridgeFailurePayload: Codable {
    let code: String
    let message: String
}

struct BridgeResponse: Codable {
    let ok: Bool
    let snapshot: WeatherSnapshotPayload?
    let error: BridgeFailurePayload?
}

@MainActor
final class LocationProvider: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation, Error>?
    private var bestLocation: CLLocation?
    private var timeoutTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = kCLDistanceFilterNone
    }

    func currentLocation() async throws -> CLLocation {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            updateAuthorization(manager.authorizationStatus)
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        updateAuthorization(manager.authorizationStatus)
    }

    func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        let candidates = locations.filter {
            $0.horizontalAccuracy >= 0 &&
                abs($0.timestamp.timeIntervalSinceNow) <= 120
        }
        guard let location = candidates.min(by: {
            $0.horizontalAccuracy < $1.horizontalAccuracy
        }) else { return }
        if let currentBest = bestLocation {
            if location.horizontalAccuracy < currentBest.horizontalAccuracy {
                bestLocation = location
            }
        } else {
            bestLocation = location
        }
        if location.horizontalAccuracy <= 250 {
            finish(with: .success(location))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(with: .failure(error))
    }

    private func updateAuthorization(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            startLocationUpdates()
        case .denied:
            finish(with: .failure(BridgeError.locationDenied))
        case .restricted:
            finish(with: .failure(BridgeError.locationRestricted))
        @unknown default:
            finish(with: .failure(BridgeError.locationUnavailable))
        }
    }

    private func startLocationUpdates() {
        manager.startUpdatingLocation()
        timeoutTask?.cancel()
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled, let self else { return }
            if let bestLocation = self.bestLocation {
                self.finish(with: .success(bestLocation))
            } else {
                self.finish(with: .failure(BridgeError.locationUnavailable))
            }
        }
    }

    private func finish(with result: Result<CLLocation, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingLocation()
        continuation.resume(with: result)
    }
}

enum Arguments {
    static func coordinates() throws -> CLLocationCoordinate2D? {
        let values = CommandLine.arguments.dropFirst()
        var latitude: Double?
        var longitude: Double?
        var iterator = values.makeIterator()

        while let argument = iterator.next() {
            switch argument {
            case "--latitude":
                latitude = iterator.next().flatMap(Double.init)
            case "--longitude":
                longitude = iterator.next().flatMap(Double.init)
            default:
                continue
            }
        }

        guard latitude != nil || longitude != nil else { return nil }
        guard let latitude, let longitude else { throw BridgeError.invalidCoordinates }
        let coordinates = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        guard CLLocationCoordinate2DIsValid(coordinates) else {
            throw BridgeError.invalidCoordinates
        }
        return coordinates
    }
}

@main
struct WeatherBridge {
    static func main() async {
        do {
            let location = try await resolveLocation()
            let payload = try await fetchWeather(for: location)
            write(BridgeResponse(ok: true, snapshot: payload, error: nil))
        } catch {
            let nsError = error as NSError
            let failure = BridgeFailurePayload(
                code: "\(nsError.domain).\(nsError.code)",
                message: error.localizedDescription
            )
            write(BridgeResponse(ok: false, snapshot: nil, error: failure))
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func resolveLocation() async throws -> CLLocation {
        if let coordinates = try Arguments.coordinates() {
            return CLLocation(latitude: coordinates.latitude, longitude: coordinates.longitude)
        }
        return try await LocationProvider().currentLocation()
    }

    private static func fetchWeather(for location: CLLocation) async throws
        -> WeatherSnapshotPayload
    {
        guard let requestURL = openMeteoURL(for: location) else {
            throw BridgeError.invalidCoordinates
        }
        let (data, response) = try await URLSession.shared.data(from: requestURL)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BridgeError.invalidWeatherResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw BridgeError.weatherServiceUnavailable(httpResponse.statusCode)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let weather = try decoder.decode(OpenMeteoResponse.self, from: data)
        let current = weather.current
        let condition = weatherCondition(code: current.weatherCode, isDaylight: current.isDay == 1)
        let place = await locationName(for: location)
        let formatter = ISO8601DateFormatter()
        let fetchedAt = Date()
        let interval = max(current.interval, 1)

        return WeatherSnapshotPayload(
            source: "open-meteo",
            condition: condition.name,
            symbolName: condition.symbolName,
            location: place,
            temperature: current.temperature2M,
            high: weather.daily.temperature2MMax.first ?? current.temperature2M,
            low: weather.daily.temperature2MMin.first ?? current.temperature2M,
            feelsLike: current.apparentTemperature,
            cloudCover: current.cloudCover / 100,
            precipitationIntensity: current.precipitation * 3_600 / interval,
            humidity: current.relativeHumidity2M / 100,
            windSpeed: current.windSpeed10M,
            isDaylight: current.isDay == 1,
            fetchedAt: formatter.string(from: fetchedAt),
            expiresAt: formatter.string(from: fetchedAt.addingTimeInterval(20 * 60)),
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            attribution: WeatherAttributionPayload(
                serviceName: "Open-Meteo",
                legalPageURL: "https://open-meteo.com/"
            )
        )
    }

    private static func openMeteoURL(for location: CLLocation) -> URL? {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(location.coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(location.coordinate.longitude)),
            URLQueryItem(
                name: "current",
                value: [
                    "temperature_2m",
                    "relative_humidity_2m",
                    "apparent_temperature",
                    "is_day",
                    "precipitation",
                    "weather_code",
                    "cloud_cover",
                    "wind_speed_10m",
                ].joined(separator: ",")
            ),
            URLQueryItem(
                name: "daily",
                value: "temperature_2m_max,temperature_2m_min"
            ),
            URLQueryItem(name: "forecast_days", value: "1"),
            URLQueryItem(name: "timeformat", value: "unixtime"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "cell_selection", value: "nearest"),
        ]
        return components?.url
    }

    private static func weatherCondition(code: Int, isDaylight: Bool)
        -> (name: String, symbolName: String)
    {
        switch code {
        case 0:
            return ("clear", isDaylight ? "sun.max.fill" : "moon.stars.fill")
        case 1:
            return ("mostlyClear", isDaylight ? "cloud.sun.fill" : "cloud.moon.fill")
        case 2:
            return ("partlyCloudy", isDaylight ? "cloud.sun.fill" : "cloud.moon.fill")
        case 3:
            return ("cloudy", "cloud.fill")
        case 45, 48:
            return ("foggy", "cloud.fog.fill")
        case 51, 53, 55:
            return ("drizzle", "cloud.drizzle.fill")
        case 56, 57:
            return ("freezingDrizzle", "cloud.sleet.fill")
        case 61, 63, 80, 81:
            return ("rain", "cloud.rain.fill")
        case 65, 82:
            return ("heavyRain", "cloud.heavyrain.fill")
        case 66, 67:
            return ("freezingRain", "cloud.sleet.fill")
        case 71, 73, 77, 85:
            return ("snow", "cloud.snow.fill")
        case 75, 86:
            return ("heavySnow", "cloud.snow.fill")
        case 95:
            return ("thunderstorms", "cloud.bolt.rain.fill")
        case 96, 99:
            return ("strongStorms", "cloud.bolt.rain.fill")
        default:
            return ("cloudy", "cloud.fill")
        }
    }

    private static func locationName(for location: CLLocation) async -> String {
        let geocoder = CLGeocoder()
        let locale = Locale(identifier: "zh_CN")
        let placemarks = try? await geocoder.reverseGeocodeLocation(
            location,
            preferredLocale: locale
        )
        guard let place = placemarks?.first else { return "当前位置" }
        return place.locality ?? place.subAdministrativeArea ?? place.administrativeArea ?? "当前位置"
    }

    private static func write(_ response: BridgeResponse) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        guard let data = try? encoder.encode(response) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}
