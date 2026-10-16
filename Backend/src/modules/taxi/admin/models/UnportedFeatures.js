import mongoose from 'mongoose';

/**
 * Read-only placeholders for taxi features that are not part of this platform build (rental,
 * service centres). The admin dashboards and reports still count / list them, and with
 * no data they simply come back empty. Collections are only touched when read, so nothing is
 * created in the database; the schemas are open (strict: false) because there is nothing to store.
 */
const placeholder = (name, collection) =>
  mongoose.models[name] || mongoose.model(name, new mongoose.Schema({}, { strict: false, collection }), collection);

export const ServiceStore = placeholder('TaxiServiceStore', 'taxi_service_stores');
export const ServiceCenterStaff = placeholder('TaxiServiceCenterStaff', 'taxi_service_center_staff');
export const RentalVehicleType = placeholder('TaxiRentalVehicleType', 'taxi_rental_vehicle_types');

export const buildRentalTrackingSnapshot = () => null;
export const RentalQuoteRequest = placeholder('TaxiRentalQuoteRequest', 'taxi_rental_quote_requests');
export const RentalBookingRequest = placeholder('TaxiRentalBookingRequest', 'taxi_rental_booking_requests');
export const RentalPackageType = placeholder('TaxiRentalPackageType', 'taxi_rental_package_types');
export const listActiveRentalTrackingBookings = async () => [];
export const listServiceStores = async () => [];
export const updateUserRentalTracking = async () => null;
