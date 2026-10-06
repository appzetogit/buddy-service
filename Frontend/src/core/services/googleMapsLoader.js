/**
 * Singleton Google Maps loader to prevent multiple map loads
 * and reduce Google Maps API costs
 */

let mapsLoadPromise = null;
let isLoaded = false;

const ensurePlacesLibrary = async () => {
  if (!window.google?.maps) return;
  if (window.google.maps.places) return;
  if (typeof window.google.maps.importLibrary === "function") {
    try {
      await window.google.maps.importLibrary("places");
    } catch {
      // ignore; caller can decide fallback behavior
    }
  }
};

export const loadGoogleMaps = (apiKey) => {
  // Return existing promise if already loading
  if (mapsLoadPromise) {
    return mapsLoadPromise.then(async (g) => {
      await ensurePlacesLibrary();
      return g;
    });
  }

  // Return resolved promise if already loaded
  if (isLoaded && window.google?.maps) {
    return Promise.resolve(window.google).then(async (g) => {
      await ensurePlacesLibrary();
      return g;
    });
  }

  // Create new load promise
  mapsLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded by another script
    if (window.google?.maps) {
      isLoaded = true;
      resolve(window.google);
      return;
    }

    // Create script element
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,drawing,geometry`;
    script.async = true;
    script.defer = true;

    script.onload = async () => {
      isLoaded = true;
      await ensurePlacesLibrary();
      resolve(window.google);
    };

    script.onerror = () => {
      mapsLoadPromise = null; // Reset so it can be retried
      reject(new Error('Failed to load Google Maps'));
    };

    document.head.appendChild(script);
  });

  return mapsLoadPromise;
};

export const isGoogleMapsLoaded = () => {
  return isLoaded && window.google?.maps;
};
