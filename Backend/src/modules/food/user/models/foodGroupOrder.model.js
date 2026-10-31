import mongoose from 'mongoose';

// One shared cart: friends join with the code, each keeps their own lines,
// and only the host turns it into a real order.
const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
    name: { type: String, trim: true, default: '' },
    // Cart lines exactly as the app serialised them. Opaque here: the host's checkout
    // re-prices everything server-side, so nothing in these is trusted for money.
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const foodGroupOrderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    restaurantId: { type: String, required: true, trim: true },
    restaurantName: { type: String, trim: true, default: '' },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
    status: { type: String, enum: ['open', 'placed', 'closed'], default: 'open' },
    orderId: { type: String, default: '' },
    members: { type: [memberSchema], default: [] },
    // Mongo drops the document a day after the group was opened.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), index: { expires: 0 } },
  },
  { timestamps: true },
);

export const FoodGroupOrder = mongoose.model('FoodGroupOrder', foodGroupOrderSchema);
