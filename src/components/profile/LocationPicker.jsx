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
  onRadiusChange,
}) {
  const [position, setPosition] = useState(
    coordinates ? [coordinates.lat, coordinates.lng] : [51.505, -0.09]
  );
  const [radiusKm, setRadiusKm] = useState(radius || 50);
  const [city, setCity] = useState(location?.city || '');
  const [country, setCountry] = useState(location?.country || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (coordinates) {
      setPosition([coordinates.lat, coordinates.lng]);
    }
  }, [coordinates]);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Instructions */}
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

      {/* Location Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">City</label>
          <Input
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              onLocationChange({ city: e.target.value, country });
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
              onLocationChange({ city, country: e.target.value });
            }}
            placeholder="e.g., UK"
            className="rounded-xl border-2"
          />
        </div>
      </div>

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
      <div className="rounded-2xl overflow-hidden border-4 border-slate-200 shadow-lg">
        <MapContainer
          center={position}
          zoom={10}
          style={{ height: '400px', width: '100%' }}
          key={`${position[0]}-${position[1]}`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LocationMarker position={position} setPosition={handlePositionUpdate} />
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
        </MapContainer>
      </div>

      {/* Radius Slider */}
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
    </motion.div>
  );
}