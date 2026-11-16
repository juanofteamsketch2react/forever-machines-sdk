/*
 * The world outside, for machines that call m.world(): a city near the visitor (from their time zone,
 * no location permission; or, in the app, where the visitor has allowed it, their own coarse location:
 * FMWorld.setPlace), its current weather from Open-Meteo, the sun's height and the moon's phase.
 * Shared by the collection and the Workbench. FMWorld.get() → Promise<world>, cached for 15 minutes.
 */
window.FMWorld = (function () {
  const CITIES = {
    Europe: ['Stockholm', 59.33, 18.07], 'Europe/London': ['London', 51.51, -0.13], 'Europe/Paris': ['Paris', 48.86, 2.35],
    'Europe/Berlin': ['Berlin', 52.52, 13.4], 'Europe/Madrid': ['Madrid', 40.42, -3.7], 'Europe/Rome': ['Rome', 41.9, 12.5],
    'Europe/Oslo': ['Oslo', 59.91, 10.75], 'Europe/Copenhagen': ['Copenhagen', 55.68, 12.57], 'Europe/Helsinki': ['Helsinki', 60.17, 24.94],
    'Europe/Amsterdam': ['Amsterdam', 52.37, 4.9], 'Europe/Lisbon': ['Lisbon', 38.72, -9.14], 'Europe/Athens': ['Athens', 37.98, 23.73],
    America: ['New York', 40.71, -74.01], 'America/Los_Angeles': ['Los Angeles', 34.05, -118.24], 'America/Chicago': ['Chicago', 41.88, -87.63],
    'America/Denver': ['Denver', 39.74, -104.99], 'America/Mexico_City': ['Mexico City', 19.43, -99.13], 'America/Sao_Paulo': ['São Paulo', -23.55, -46.63],
    'America/Argentina/Buenos_Aires': ['Buenos Aires', -34.6, -58.38], 'America/Toronto': ['Toronto', 43.65, -79.38], 'America/Bogota': ['Bogotá', 4.71, -74.07],
    Asia: ['Tokyo', 35.68, 139.69], 'Asia/Shanghai': ['Shanghai', 31.23, 121.47], 'Asia/Kolkata': ['Mumbai', 19.08, 72.88], 'Asia/Dubai': ['Dubai', 25.2, 55.27],
    'Asia/Singapore': ['Singapore', 1.35, 103.82], 'Asia/Seoul': ['Seoul', 37.57, 126.98], 'Asia/Bangkok': ['Bangkok', 13.76, 100.5],
    Africa: ['Nairobi', -1.29, 36.82], 'Africa/Lagos': ['Lagos', 6.52, 3.38], 'Africa/Cairo': ['Cairo', 30.04, 31.24], 'Africa/Johannesburg': ['Johannesburg', -26.2, 28.05],
    Australia: ['Sydney', -33.87, 151.21], 'Australia/Melbourne': ['Melbourne', -37.81, 144.96], Pacific: ['Auckland', -36.85, 174.76],
  };
  let place = null; // the visitor's own place, if they allowed it: { name, lat, lon } (rounded to about a kilometre)
  function pickCity() {
    if (place) return place;
    let tz = 'Europe/Stockholm';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (_) {}
    const c = CITIES[tz] || CITIES[tz.split('/')[0]] || CITIES.Europe;
    return { name: c[0], lat: c[1], lon: c[2] };
  }
  const WMO = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm, hail', 99: 'thunderstorm, hail' };
  function sunAltitude(lat, lon, d) {
    const rad = Math.PI / 180, days = d / 864e5 - 10957.5; // since J2000
    const L = (280.46 + 0.9856474 * days) % 360, g = (357.528 + 0.9856003 * days) % 360;
    const lambda = L + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad), eps = 23.439 - 4e-7 * days;
    const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
    const ra = Math.atan2(Math.cos(eps * rad) * Math.sin(lambda * rad), Math.cos(lambda * rad));
    const gmst = (18.697374558 + 24.06570982441908 * days) % 24;
    const ha = ((gmst * 15 + lon) * rad) - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
  }
  let world = null, worldAt = 0;
  async function getWorld() {
    if (world && Date.now() - worldAt < 15 * 60e3) return world;
    const city = pickCity(), now = new Date();
    let w = null;
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,is_day&timezone=auto`;
      const j = await fetch(u).then((r) => r.json());
      const c = j.current || {};
      w = { tempC: c.temperature_2m, humidity: c.relative_humidity_2m, precipMm: c.precipitation, cloud: c.cloud_cover, windKmh: c.wind_speed_10m,
            windDir: c.wind_direction_10m, code: c.weather_code, description: WMO[c.weather_code] || 'unknown', isDay: !!c.is_day, utcOffset: j.utc_offset_seconds };
    } catch (_) { w = null; } // offline or blocked: machines get sun, moon and time only
    const offset = w && isFinite(w.utcOffset) ? w.utcOffset : -now.getTimezoneOffset() * 60;
    const local = new Date(now.getTime() + offset * 1000);
    world = {
      city: city.name, lat: city.lat, lon: city.lon,
      hour: local.getUTCHours() + local.getUTCMinutes() / 60, month: local.getUTCMonth() + 1, weekday: local.getUTCDay(),
      sunAltitude: +sunAltitude(city.lat, city.lon, now.getTime()).toFixed(1),
      moonPhase: +((((now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530588853) / 29.530588853).toFixed(3),
      weather: w, fetched: now.toISOString(),
    };
    worldAt = Date.now();
    return world;
  }
  function setPlace(p) {
    place = p && isFinite(p.lat) && isFinite(p.lon) ? { name: String(p.name || 'here').slice(0, 40), lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 } : null;
    world = null; // the next machine to ask gets the new place
  }
  // the browser's own location (asked only when the visitor says so; the browser asks too): approximate, rounded to about
  // a kilometre, named after the nearest city in the list above when one is within 150 km, else just "here". Nothing is
  // stored; only the rounded position goes to Open-Meteo, for the weather.
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('none'));
      navigator.geolocation.getCurrentPosition((p) => {
        const lat = Math.round(p.coords.latitude * 100) / 100, lon = Math.round(p.coords.longitude * 100) / 100;
        let best = null, bd = 1e9;
        for (const c of Object.values(CITIES)) { const d = km(lat, lon, c[1], c[2]); if (d < bd) { bd = d; best = c[0]; } }
        resolve({ name: bd <= 150 ? best : 'here', lat, lon });
      }, (e) => reject(new Error(e && e.code === 1 ? 'denied' : 'none')), { maximumAge: 15 * 60e3, timeout: 12000, enableHighAccuracy: false });
    });
  }
  return { get: getWorld, setPlace, place: () => place, locate };
})();
