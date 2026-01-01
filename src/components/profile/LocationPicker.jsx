import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Marker, useMapEvents } from 'react-leaflet';
import { motion } from 'framer-motion';
import { MapPin, Loader2, Target } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

function LocationMarker({ position, setPosition }) {
  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
    },
  });

  return position ? <Marker position={position} /> : null;
}

export default function LocationPicker({
  location,
  coordinates,
  radius,
  onLocationChange,
  onCoordinatesChange,
  onApplyResult,
  onRadiusChange,
  showRadius = true,
  showIntro = true,
  showInputs = true,
  mapHeight = 320,
}) {
  const [position, setPosition] = useState(
    coordinates ? [coordinates.lat, coordinates.lng] : [51.505, -0.09]
  );
  const [radiusKm, setRadiusKm] = useState(radius || 50);
  const [city, setCity] = useState(location?.city || '');
  const [country, setCountry] = useState(location?.country || '');
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyNote, setApplyNote] = useState('');

  useEffect(() => {
    if (coordinates) {
      setPosition([coordinates.lat, coordinates.lng]);
    }
  }, [coordinates]);

  useEffect(() => {
    if (!location) {
      setCity('');
      setCountry('');
      return;
    }
    setCity(location?.city || '');
    setCountry(location?.country || '');
  }, [location]);

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newPos = [pos.coords.latitude, pos.coords.longitude];
        setPosition(newPos);
        onCoordinatesChange?.({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        onLocationChange({ city, country });
        setLoading(false);
      },
      () => {
        alert('Unable to retrieve your location');
        setLoading(false);
      }
    );
  };

  const handleRadiusChange = (value) => {
    setRadiusKm(value[0]);
    onRadiusChange(value[0]);
  };

  const handlePositionUpdate = (newPos) => {
    setPosition(newPos);
    onCoordinatesChange?.({ lat: newPos[0], lng: newPos[1] });
    onLocationChange({ city, country });
  };

  const geocodeCityLevel = async ({ city: nextCity, country: nextCountry }) => {
    const c = String(nextCity || '').trim();
    const k = String(nextCountry || '').trim();
    const query = [c, k].filter(Boolean).join(', ');
    if (!query) return null;

    const cacheKey = `peoplepower_geocode_${query.toLowerCase()}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object' && parsed.lat != null && parsed.lng != null) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const first = Array.isArray(json) ? json[0] : null;
    if (!first?.lat || !first?.lon) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const rounded = { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) };
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(rounded));
    } catch {
      // ignore
    }
    return rounded;
  };

  const handleApplyLocation = async () => {
    const cityValue = String(city || '').trim();
    const countryValue = String(country || '').trim();
    if (!cityValue && !countryValue) {
      setApplyNote('Enter a city or country to apply.');
      return;
    }
    setApplyLoading(true);
    setApplyNote('');
    try {
      const coords = await geocodeCityLevel({ city: cityValue, country: countryValue });
      if (coords) {
        const nextPos = [coords.lat, coords.lng];
        setPosition(nextPos);
        onCoordinatesChange?.({ lat: coords.lat, lng: coords.lng });
        setApplyNote('Location applied to the map.');
        onApplyResult?.({ ok: true, coords, message: 'Location applied to the map.' });
      } else {
        setApplyNote('City saved. We could not resolve map coordinates.');
        onCoordinatesChange?.(null);
        onApplyResult?.({
          ok: false,
          coords: null,
          message: 'Saved city/country, but couldn’t place it on the map.',
        });
      }
      onLocationChange({ city: cityValue, country: countryValue });
    } catch {
      setApplyNote('Could not apply that location. Please try again.');
      onApplyResult?.({ ok: false, coords: null, message: 'Could not apply that location.' });
    } finally {
      setApplyLoading(false);
    }
  };

  const mapStyle = {
    height: typeof mapHeight === 'number' ? `${mapHeight}px` : mapHeight,
    width: '100%',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Instructions */}
      {showIntro ? (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-4 border-2 border-indigo-200">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-[#3A3DFF] mt-0.5" />
            <div>
              <h4 className="font-black text-slate-900 mb-1">Set Your Location</h4>
              <p className="text-sm text-slate-600">
                Choose an area to power the Local tab. We only save your city/country to your profile.
                Your precise coordinates stay on your device and are only used to filter nearby movements.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Location Inputs */}
      {showInputs ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">City</label>
          <Input
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
            }}
            placeholder="e.g., London"
            className="rounded-xl border-2"
          />
        </div>
        <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Country</label>
          <Input
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
            placeholder="e.g., UK"
            className="rounded-xl border-2"
          />
        </div>
      </div>
      ) : null}

      {showInputs ? (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 font-semibold">
            Use the button below to apply your selected city to the map and your local feed.
          </div>
          <Button
            type="button"
            onClick={handleApplyLocation}
            disabled={applyLoading}
            variant="outline"
            className="w-full rounded-xl border-2 font-bold"
          >
            {applyLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MapPin className="w-4 h-4 mr-2" />
            )}
            Apply location
          </Button>
          {applyNote ? (
            <div className="text-xs text-slate-600 font-semibold">{applyNote}</div>
          ) : null}
        </div>
      ) : null}

      {/* Current Location Button */}
      <Button
        type="button"
        onClick={handleGetCurrentLocation}
        disabled={loading}
        variant="outline"
        className="w-full rounded-xl border-2 font-bold"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Target className="w-4 h-4 mr-2" />
        )}
        Use Current Location
      </Button>

      {/* Map */}
      <div className="relative z-0 rounded-2xl overflow-hidden border-4 border-slate-200 shadow-lg">
        <MapContainer
          center={position}
          zoom={10}
          style={{ ...mapStyle, zIndex: 0 }}
          className="z-0"
          key={`${position[0]}-${position[1]}`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LocationMarker position={position} setPosition={handlePositionUpdate} />
          {showRadius ? (
            <Circle
              center={position}
              radius={radiusKm * 1000}
              pathOptions={{
                color: '#3A3DFF',
                fillColor: '#3A3DFF',
                fillOpacity: 0.1,
                weight: 3
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      {/* Radius Slider */}
      {showRadius ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-black text-slate-900 uppercase">Catchment Radius</label>
            <span className="text-lg font-black text-[#3A3DFF]">{radiusKm} km</span>
          </div>
          <Slider
            value={[radiusKm]}
            onValueChange={handleRadiusChange}
            min={5}
            max={200}
            step={5}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-slate-500 font-bold">
            <span>5 km</span>
            <span>50 km</span>
            <span>100 km</span>
            <span>200 km</span>
          </div>
          <p className="text-sm text-slate-600">
            Movements within <strong className="text-[#3A3DFF]">~{radiusKm}km</strong> of your selected area will appear in the Local tab.
          </p>
        </div>
      ) : null}
    </motion.div>
  );
}
