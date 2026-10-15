import mongoose from 'mongoose';

/**
 * Read-only placeholders for taxi features that are not part of this platform build (fleet owners,
 * bus, rental, service centres). The admin dashboards and reports still count / list them, and with
 * no data they simply come back empty. Collections are only touched when read, so nothing is
 * created in the database; the schemas are open (strict: false) because there is nothing to store.
 */
const placeholder = (name, collection) =>
  mongoose.models[name] || mongoose.model(name, new mongoose.Schema({}, { strict: false, collection }), collection);

export const Owner = placeholder('TaxiOwner', 'taxi_owners');
export const OwnerWalletTransaction = placeholder('TaxiOwnerWalletTransaction', 'taxi_owner_wallet_transactions');
export const OwnerBooking = placeholder('TaxiOwnerBooking', 'taxi_owner_bookings');
export const FleetVehicle = placeholder('TaxiFleetVehicle', 'taxi_fleet_vehicles');
export const BusService = placeholder('TaxiBusService', 'taxi_bus_services');
export const BusBooking = placeholder('TaxiBusBooking', 'taxi_bus_bookings');
export const BusSeatHold = placeholder('TaxiBusSeatHold', 'taxi_bus_seat_holds');
export const BusDriver = placeholder('TaxiBusDriver', 'taxi_bus_drivers');
export const ServiceStore = placeholder('TaxiServiceStore', 'taxi_service_stores');
export const ServiceCenterStaff = placeholder('TaxiServiceCenterStaff', 'taxi_service_center_staff');
export const RentalVehicleType = placeholder('TaxiRentalVehicleType', 'taxi_rental_vehicle_types');

export const buildRentalTrackingSnapshot = () => null;
export const PoolingRoute = placeholder('TaxiPoolingRoute', 'taxi_pooling_routes');
export const RentalQuoteRequest = placeholder('TaxiRentalQuoteRequest', 'taxi_rental_quote_requests');
export const RentalBookingRequest = placeholder('TaxiRentalBookingRequest', 'taxi_rental_booking_requests');
export const RentalPackageType = placeholder('TaxiRentalPackageType', 'taxi_rental_package_types');
export const OwnerNeededDocument = placeholder('TaxiOwnerNeededDocument', 'taxi_owner_needed_documents');
export const listActiveRentalTrackingBookings = async () => [];
export const listServiceStores = async () => [];
export const updateUserRentalTracking = async () => null;
