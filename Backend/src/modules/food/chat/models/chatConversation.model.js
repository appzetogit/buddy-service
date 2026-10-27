import mongoose from 'mongoose';

/**
 * One conversation between two parties — either tied to a specific order
 * (customer/restaurant/rider talking about that delivery) or a general
 * support thread with admin (orderId null).
 *
 * `partyAToken`/`partyBToken` are "ROLE:id" strings (ROLE="ADMIN" has no id),
 * stored with partyAToken < partyBToken so a pair always maps to one row —
 * callers resolve "my conversation with X" without needing to know who
 * started it.
 */
const chatConversationSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', default: null, index: true },
        partyAToken: { type: String, required: true, trim: true },
        partyBToken: { type: String, required: true, trim: true },
        lastMessage: { type: String, default: '', trim: true },
        lastAt: { type: Date, default: null },
        lastSenderToken: { type: String, default: '', trim: true },
        unreadForA: { type: Number, default: 0, min: 0 },
        unreadForB: { type: Number, default: 0, min: 0 },
    },
    { collection: 'food_chat_conversations', timestamps: true }
);

chatConversationSchema.index({ orderId: 1, partyAToken: 1, partyBToken: 1 }, { unique: true });
chatConversationSchema.index({ partyAToken: 1, lastAt: -1 });
chatConversationSchema.index({ partyBToken: 1, lastAt: -1 });

export const FoodChatConversation = mongoose.model('FoodChatConversation', chatConversationSchema);
