// Shared geocoding guards, used both when geocoding (refresh.js) and when repairing existing
// rows on startup (db.js). Weather is only ever shown as context, so the rule throughout is:
// a point we aren't confident about gets no weather rather than weather from the wrong place.

// A geocoded point must land inside the continental US, Alaska or Hawaii. A plain lat/lon box
// stretched to the borders let wrong matches through (Decker Lake -> British Columbia, Market
// Place -> US Virgin Islands), so it is three tight regions that exclude Canada, Mexico and the
// Caribbean territories.
export function inUSBox(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return false;
  const conus = lat >= 24.4 && lat <= 49.4 && lon >= -125.0 && lon <= -66.9;
  const alaska = lat >= 51.2 && lat <= 71.6 && lon >= -172.5 && lon <= -129.9;
  const hawaii = lat >= 18.9 && lat <= 22.3 && lon >= -160.3 && lon <= -154.8;
  return conus || alaska || hawaii;
}

// Words that carry no geographic identity on their own, so a store called only these ("Market
// Place", "Research Blvd") can't be matched to a city with any confidence.
const GENERIC_PLACE_WORDS = new Set(["lake", "place", "market", "creek", "green", "park", "city",
  "town", "village", "north", "south", "east", "west", "new", "old", "fort", "mount", "saint",
  "the", "of", "at", "and", "center", "centre", "square", "plaza", "mall", "road", "street", "lane",
  "drive", "avenue", "blvd", "boulevard", "highway", "freeway", "heights", "hills", "hill", "valley",
  "interstate", "route", "commons", "crossing", "landing", "station", "outlet", "outlets"]);

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);

// A store name has a distinctive word if it has any word (>= 4 letters) that isn't a generic
// place word. Names without one ("Market Place") can't be geocoded reliably.
export function distinctiveCity(name) {
  return words(name).some((w) => !GENERIC_PLACE_WORDS.has(w));
}

// A geocode result is accepted only if its name shares a distinctive word with the store name,
// or one name contains the other — so "Decker Lake" -> "Decker Creek Dam" (Texas) is kept but
// "Market Place" -> "New Haven Green" (Connecticut) is rejected.
export function nameMatches(storeName, hitName) {
  const a = new Set(words(storeName));
  if (words(hitName).some((w) => a.has(w) && !GENERIC_PLACE_WORDS.has(w))) return true;
  const na = String(storeName).toLowerCase(); const nb = String(hitName).toLowerCase();
  return Boolean(na) && Boolean(nb) && (na.includes(nb) || nb.includes(na));
}
