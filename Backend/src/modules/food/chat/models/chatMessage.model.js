import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
    {
        conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodChatConversation', required: true, index: true },
        senderToken: { type: String, required: true, trim: true },
        text: { type: String, required: true, trim: true, maxlength: 2000 },
    },
    { collection: 'food_chat_messages', timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const FoodChatMessage = mongoose.model('FoodChatMessage', chatMessageSchema);
