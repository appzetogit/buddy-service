import mongoose from 'mongoose';

/**
 * The rider (driver) a taxi ride is given to.
 *
 * Taxi has no driver accounts of its own: the people who take rides are the platform's delivery
 * partners (the same riders who carry Food and Quick Commerce orders). So this is not a separate
 * collection - it is a second, open view over the delivery-partner collection, which lets the ride
 * services keep reading and writing "driver" fields (isOnRide, wallet, vehicle...) without a
 * parallel account system. Field names the platform already has (name, phone, vehicleType,
 * vehicleNumber, rating, profilePhoto, currentLocation, availabilityStatus) are the platform's;
 * anything taxi adds (isOnRide, taxi*) is stored next to them and ignored by Food / Quick Commerce.
 *
 * It is `strict: false` on purpose: the platform's own model stays the single owner of the shape,
 * and this view must never alter indexes or collection metadata (autoIndex / autoCreate off).
 */
const PARTNER_COLLECTION = 'buddy_deliveries';

const driverSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    profilePhoto: { type: String, default: '' },
    isOnRide: { type: Boolean, default: false },
  },
  {
    strict: false,
    collection: PARTNER_COLLECTION,
    autoIndex: false,
    autoCreate: false,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// The ride screens read `profileImage` / `isOnline`; on a delivery partner those live under their
// platform names.
driverSchema.virtual('profileImage').get(function profileImage() {
  return this.get('profilePhoto') || '';
});
driverSchema.virtual('isOnline').get(function isOnline() {
  return this.get('availabilityStatus') === 'online';
});

// The rider app shows a make / model / colour line; a delivery partner keeps one vehicle name.
driverSchema.virtual('vehicleModel').get(function vehicleModel() {
  return this.get('vehicleName') || '';
});
driverSchema.virtual('vehicleMake').get(function vehicleMake() {
  return '';
});
driverSchema.virtual('vehicleColor').get(function vehicleColor() {
  return '';
});

export const Driver = mongoose.models.TaxiDriver || mongoose.model('TaxiDriver', driverSchema);
