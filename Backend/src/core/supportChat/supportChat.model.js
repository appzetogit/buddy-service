import mongoose from 'mongoose';

/** Roles that can talk to the admin. Unified DRIVER logins are stored as DELIVERY_PARTNER. */
export const CHAT_ROLES = ['USER', 'SELLER', 'RESTAURANT', 'DELIVERY_PARTNER'];

/** One thread per participant (role + id); every admin shares it as an inbox. */
const threadSchema = new mongoose.Schema(
    {
        participantRole: { type: String, enum: CHAT_ROLES, required: true },
        participantId: { type: mongoose.Schema.Types.ObjectId, required: true },
        // Snapshot taken when the thread is created, so the admin list needs no joins.
        name: { type: String, default: '', trim: true },
        phone: { type: String, default: '', trim: true },
        lastMessage: { type: String, default: '' },
        lastAt: { type: Date, default: null },
        lastSender: { type: String, enum: ['ADMIN', 'PARTICIPANT', ''], default: '' },
        unreadForAdmin: { type: Number, default: 0, min: 0 },
        unreadForParticipant: { type: Number, default: 0, min: 0 },
    },
    { collection: 'support_chat_threads', timestamps: true },
);
threadSchema.index({ participantRole: 1, participantId: 1 }, { unique: true });
threadSchema.index({ lastAt: -1, _id: -1 });
threadSchema.index({ participantRole: 1, lastAt: -1 });

const messageSchema = new mongoose.Schema(
    {
        threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportChatThread', required: true },
        sender: { type: String, enum: ['ADMIN', 'PARTICIPANT'], required: true },
        senderId: { type: mongoose.Schema.Types.ObjectId, default: null }, // who sent it (admin or participant)
        text: { type: String, required: true, trim: true, maxlength: 2000 },
        // Client-generated id: a retry after a network drop must not create a duplicate message.
        clientId: { type: String, default: undefined, maxlength: 64 },
    },
    { collection: 'support_chat_messages', timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ threadId: 1, _id: -1 });
messageSchema.index(
    { threadId: 1, clientId: 1 },
    { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);

/** Singleton: the hours in which admin chat is open. */
const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'main', unique: true },
        enabled: { type: Boolean, default: true }, // false = chat closed for everyone
        timezone: { type: String, default: 'Asia/Kolkata' },
        startTime: { type: String, default: '09:00' }, // HH:mm
        endTime: { type: String, default: '21:00' }, // HH:mm (earlier than start = runs past midnight)
        days: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] }, // 0 = Sunday
        closedMessage: { type: String, default: 'Chat is closed right now. Please try during chat hours.' },
    },
    { collection: 'support_chat_settings', timestamps: true },
);

export const SupportChatThread =
    mongoose.models.SupportChatThread || mongoose.model('SupportChatThread', threadSchema);
export const SupportChatMessage =
    mongoose.models.SupportChatMessage || mongoose.model('SupportChatMessage', messageSchema);
export const SupportChatSettings =
    mongoose.models.SupportChatSettings || mongoose.model('SupportChatSettings', settingsSchema);
