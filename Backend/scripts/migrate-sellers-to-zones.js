import mongoose from "mongoose";
import dotenv from "dotenv";
import Seller from "../src/modules/quickCommerce/models/seller.js";
import { FoodZone } from "../src/modules/food/admin/models/zone.model.js";

// Load configuration
dotenv.config();

const isPointInPolygon = (lat, lng, polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

async function runMigration() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/buddy_service";
  console.log(`Connecting to database: ${mongoUri}`);
  
  await mongoose.connect(mongoUri);
  console.log("Database connected successfully.");

  // Fetch all active zones
  const zones = await FoodZone.find({ isActive: true }).lean();
  console.log(`Loaded ${zones.length} active FoodZones.`);

  // Fetch all sellers without zoneId
  const sellers = await Seller.find({
    $or: [
      { zoneId: { $exists: false } },
      { zoneId: null }
    ]
  });
  console.log(`Found ${sellers.length} sellers requiring zone mapping.`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const seller of sellers) {
    const coords = seller.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      console.warn(`Seller "${seller.shopName}" (${seller._id}) has no valid location coordinates. Skipped.`);
      skippedCount++;
      continue;
    }

    const [lng, lat] = coords;
    let matchedZoneId = null;

    for (const zone of zones) {
      if (isPointInPolygon(lat, lng, zone.coordinates)) {
        matchedZoneId = zone._id;
        break;
      }
    }

    if (matchedZoneId) {
      seller.zoneId = matchedZoneId;
      await seller.save();
      console.log(`Mapped Seller "${seller.shopName}" to Zone "${matchedZoneId}".`);
      migratedCount++;
    } else {
      console.warn(`Seller "${seller.shopName}" (${seller._id}) is outside all active zones. Skipped.`);
      skippedCount++;
    }
  }

  console.log(`Migration complete. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
  await mongoose.connection.close();
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
