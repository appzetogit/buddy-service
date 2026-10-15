import mongoose from 'mongoose';

/**
 * The taxi view of the platform customer wallet.
 *
 * A customer has ONE wallet across Food, Quick Commerce and Taxi: this model reads and writes the
 * same `food_user_wallets` document the other modules use, so a Food top-up pays for a ride and a
 * ride refund can pay for dinner. Both modules keep their own transaction shape in the shared
 * `transactions` array; every entry carries Food's `type` as well (derived from taxi's `kind`
 * below), so neither module trips over the other's rows.
 */
const walletTransactionSchema = new mongoose.Schema(
  {
    // Taxi's own shape.
    kind: { type: String, enum: ['credit', 'debit'] },
    title: { type: String, default: '', trim: true },
    counterpartyPhone: { type: String, default: '', trim: true },
    provider: { type: String, default: '', trim: true },
    providerOrderId: { type: String, default: '', trim: true },
    providerPaymentId: { type: String, default: '', trim: true },
    referenceKey: { type: String, default: '', trim: true },
    // Platform shape (see food/user/models/userWallet.model.js).
    type: { type: String, enum: ['addition', 'deduction', 'refund'] },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Completed' },
    description: { type: String, default: '' },
    metadata: { type: Object, default: {} },
  },
  { _id: true, timestamps: true },
);

const KIND_TO_TYPE = { credit: 'addition', debit: 'deduction' };

/** Fill in whichever of `kind` / `type` the writer did not provide, plus a description. */
const completeTransaction = (tx) => {
  if (!tx || typeof tx !== 'object') return tx;
  const next = { ...tx };
  if (!next.type && next.kind) next.type = KIND_TO_TYPE[next.kind] || 'addition';
  if (!next.kind && next.type) next.kind = next.type === 'deduction' ? 'debit' : 'credit';
  if (!next.status) next.status = 'Completed';
  if (!next.description && next.title) next.description = next.title;
  if (!next.title && next.description) next.title = next.description;
  return next;
};

const userWalletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true },
    balance: { type: Number, default: 0, min: 0, index: true },
    refundWallet: { type: Number, default: 0, min: 0 },
    referralEarnings: { type: Number, default: 0 },
    transactions: { type: [walletTransactionSchema], default: [] },
  },
  { collection: 'food_user_wallets', timestamps: true },
);

userWalletSchema.index({ userId: 1 }, { unique: true });

// The taxi code used to cap history with `$slice: -50`; on a wallet shared with other modules that
// would silently delete their transactions, so the cap is dropped. Every pushed entry is completed
// so it is valid for the other modules too.
userWalletSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function normalizePushedTransactions() {
  const update = this.getUpdate();
  const pushed = update?.$push?.transactions;
  if (!pushed) return;

  if (pushed.$each) {
    pushed.$each = pushed.$each.map(completeTransaction);
    delete pushed.$slice;
  } else {
    update.$push.transactions = completeTransaction(pushed);
  }
});

userWalletSchema.pre('validate', function completeTransactionsOnSave() {
  (this.transactions || []).forEach((tx) => {
    const completed = completeTransaction(typeof tx.toObject === 'function' ? tx.toObject() : tx);
    if (!tx.type && completed.type) tx.type = completed.type;
    if (!tx.kind && completed.kind) tx.kind = completed.kind;
    if (!tx.description && completed.description) tx.description = completed.description;
  });
});

export const UserWallet = mongoose.models.TaxiUserWallet || mongoose.model('TaxiUserWallet', userWalletSchema);
