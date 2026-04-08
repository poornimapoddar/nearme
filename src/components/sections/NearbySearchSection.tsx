"use client";

import dynamic from "next/dynamic";
import { FormEvent, useMemo, useState } from "react";
import { formatDistance, haversineDistanceMeters } from "@/lib/distance";
import type { Place, UserLocation } from "@/types/place";

const NearbyMap = dynamic(() => import("@/components/sections/NearbyMap"), {
  ssr: false,
});

const DEFAULT_RADIUS_METERS = 5000;
const RADIUS_OPTIONS = [5000, 10000, 15000, 20000, 30000] as const;
const AUTO_EXPAND_BASE_STEPS = [5000, 10000, 15000, 20000, 30000];

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

function parsePlace(item: NominatimResult, userLocation: UserLocation): Place {
  const [name, ...rest] = item.display_name.split(",");
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  const distanceMeters = haversineDistanceMeters(userLocation.lat, userLocation.lng, lat, lon);

  return {
    id: String(item.place_id),
    name: name?.trim() || "Unnamed place",
    address: rest.slice(0, 2).join(",").trim() || "Address unavailable",
    lat,
    lon,
    distanceMeters,
  };
}

function getBoundingBox(location: UserLocation, radiusMeters: number): string {
  const earthRadius = 6371000;
  const dLat = (radiusMeters / earthRadius) * (180 / Math.PI);
  const dLng = dLat / Math.cos((location.lat * Math.PI) / 180);

  const left = location.lng - dLng;
  const top = location.lat + dLat;
  const right = location.lng + dLng;
  const bottom = location.lat - dLat;

  return `${left},${top},${right},${bottom}`;
}

export default function NearbySearchSection() {
  const [query, setQuery] = useState("salon");
  const [radiusMeters, setRadiusMeters] = useState<number>(DEFAULT_RADIUS_METERS);
  const [customRadiusKm, setCustomRadiusKm] = useState<string>("5");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Search for a place near you.");
  const [isLoading, setIsLoading] = useState(false);

  const effectiveCenter = useMemo<UserLocation>(
    () => userLocation ?? { lat: 20.5937, lng: 78.9629 },
    [userLocation]
  );

  const requestCurrentLocation = (): Promise<UserLocation> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported in this browser."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => reject(new Error("Location permission denied. Please allow location access.")),
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });

  const fetchNearbyWithinRadius = async (
    term: string,
    location: UserLocation,
    selectedRadius: number
  ): Promise<Place[]> => {
    const viewbox = getBoundingBox(location, selectedRadius);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?` +
        new URLSearchParams({
          q: term,
          format: "json",
          limit: "50",
          addressdetails: "1",
          bounded: "1",
          viewbox,
        }).toString()
    );

    if (!response.ok) {
      throw new Error("Search failed. Please try again.");
    }

    const raw = (await response.json()) as NominatimResult[];
    return raw
      .map((item) => parsePlace(item, location))
      .filter((item) => item.distanceMeters <= selectedRadius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  };

  const fetchGlobalMatches = async (term: string, location: UserLocation): Promise<Place[]> => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?` +
        new URLSearchParams({
          q: term,
          format: "json",
          limit: "50",
          addressdetails: "1",
        }).toString()
    );

    if (!response.ok) {
      throw new Error("Search failed. Please try again.");
    }

    const raw = (await response.json()) as NominatimResult[];
    return raw
      .map((item) => parsePlace(item, location))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  };

  const getExpandedRadiusSequence = (startRadius: number): number[] => {
    const sequence = new Set<number>([startRadius, ...AUTO_EXPAND_BASE_STEPS]);
    let nextRadius = 40000;

    // No fixed upper limit in UX; this keeps requesting wider ranges progressively.
    while (sequence.size < 18) {
      sequence.add(nextRadius);
      nextRadius += 20000;
    }

    return [...sequence].sort((a, b) => a - b).filter((value) => value >= startRadius);
  };

  const runSearch = async (term: string, selectedRadius: number) => {
    if (!term.trim()) return;

    setIsLoading(true);
    setStatus("Detecting your location...");

    try {
      const location = await requestCurrentLocation();
      setUserLocation(location);
      const expandedRadii = getExpandedRadiusSequence(selectedRadius);
      let foundPlaces: Place[] = [];
      let matchedRadius = selectedRadius;

      for (const radius of expandedRadii) {
        setStatus(`Searching "${term}" within ${formatDistance(radius)}...`);
        const currentResults = await fetchNearbyWithinRadius(term, location, radius);
        if (currentResults.length > 0) {
          foundPlaces = currentResults;
          matchedRadius = radius;
          break;
        }
      }

      if (foundPlaces.length === 0) {
        setStatus(`Expanding search globally for "${term}"...`);
        foundPlaces = await fetchGlobalMatches(term, location);
      }

      const uniqueById = new Map(foundPlaces.map((place) => [place.id, place]));
      const sortedPlaces = [...uniqueById.values()].sort(
        (a, b) => a.distanceMeters - b.distanceMeters
      );

      if (sortedPlaces.length > 0) {
        setRadiusMeters(Math.max(selectedRadius, matchedRadius));
      }

      setPlaces(sortedPlaces);
      setSelectedPlaceId(sortedPlaces[0]?.id ?? null);
      setStatus(
        sortedPlaces.length > 0
          ? `${sortedPlaces.length} result(s) found. Nearest first by distance.`
          : `No matching data available for "${term}".`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setStatus(message);
      setPlaces([]);
      setSelectedPlaceId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runSearch(query, radiusMeters);
  };

  return (
    <section className="nearby-shell">
      <form className="toolbar" onSubmit={onSubmit}>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search service, e.g. "salon"'
        />
        <button className="search-button" type="submit" disabled={isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </button>
      </form>

      <div className="radius-row">
        {RADIUS_OPTIONS.map((value) => (
          <button
            key={value}
            type="button"
            className={`radius-pill ${radiusMeters === value ? "active" : ""}`}
            onClick={() => {
              setRadiusMeters(value);
              if (userLocation) void runSearch(query, value);
            }}
          >
            {value / 1000} km
          </button>
        ))}
        <label className="radius-custom">
          <span>Custom km</span>
          <input
            type="number"
            min="1"
            step="1"
            value={customRadiusKm}
            onChange={(event) => setCustomRadiusKm(event.target.value)}
            onBlur={() => {
              const parsedKm = Number(customRadiusKm);
              if (!Number.isFinite(parsedKm) || parsedKm <= 0) return;
              const customMeters = Math.round(parsedKm * 1000);
              setRadiusMeters(customMeters);
              if (userLocation) void runSearch(query, customMeters);
            }}
          />
        </label>
      </div>

      <div className="content-grid">
        <div className="map-panel">
          <NearbyMap
            center={effectiveCenter}
            places={places}
            radiusMeters={radiusMeters}
            selectedPlaceId={selectedPlaceId}
            onSelectPlace={setSelectedPlaceId}
          />
          <div className="status-chip">{status}</div>
        </div>

        <aside className="results-panel">
          <h2>Nearby Results</h2>
          <p>{places.length} found</p>
          <div className="results-list">
            {places.length === 0 ? (
              <div className="result-empty">
                No nearby places yet. Try searching &quot;salon&quot;.
              </div>
            ) : (
              places.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className={`result-card ${selectedPlaceId === place.id ? "active" : ""}`}
                  onClick={() => setSelectedPlaceId(place.id)}
                >
                  <strong>{place.name}</strong>
                  <span>{place.address}</span>
                  <small>{formatDistance(place.distanceMeters)} away</small>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
