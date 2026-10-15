import mongoose from 'mongoose';
import { riderOrders } from './riderOrderSources.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { getDeliveryCashLimitSettings } from '../../admin/services/admin.service.js';
import { getBalance } from '../../../../core/payments/transaction.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { assertRazorpayAvailableInProduction, createRazorpayOrder, getRazorpayKeyId, isRazorpayConfigured, verifyPaymentSignature } from '../../orders/helpers/razorpay.helper.js';
import { resolveRiderPayoutAmount } from '../../orders/services/order.helpers.js';

/**
 * Enhanced wallet fetch for delivery partners.
 * Integrates:
 * 1. Historical orders (earnings)
 * 2. Admin bonuses
 * 3. Withdrawals (pending/payout)
 * 4. Cash collected vs limit
 */
export const getDeliveryPartnerWalletEnhanced = async (deliveryPartnerId) => {
    if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        throw new ValidationError('Invalid delivery partner ID');
    }

    let partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
    if (!partner) {
        partner = await FoodDeliveryPartner.findOne({ identityId: deliveryPartnerId }).lean();
    }
    if (!partner) throw new ValidationError('Delivery partner not found');

    const partnerId = partner._id;

    const [cashLimitSettings, ordersRes, cashCollectedRes, depositsRes, bonusRes, withdrawalsRes] = await Promise.all([
        getDeliveryCashLimitSettings(),
        riderOrders.aggregate([
            { 
                $match: { 
                    $and: [
                        {
                            $or: [
                                { 'dispatch.deliveryPartnerId': partnerId },
                                { 'dispatch.sharedPartnerId': partnerId }
                            ]
                        },
                        { orderStatus: { $in: ['delivered', 'completed', 'DELIVERED', 'COMPLETED'] } }
                    ]
                } 
            },
            { 
                $group: { 
                    _id: null, 
                    totalEarned: { 
                        $sum: { 
                            $cond: [
                                { $eq: ["$dispatch.deliveryPartnerId", partnerId] },
                                {
                                  $ifNull: [
                                    "$riderEarning",
                                    {
                                      $ifNull: [
                                        "$pricing.deliveryFeeBreakdown.riderFee",
                                        {
                                          $ifNull: [
                                            "$settlementBreakdown.driver.payout",
                                            { $ifNull: ["$pricing.deliveryFeeBreakdown.deliveryBoyFee", 0] },
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                                { $ifNull: ["$sharedRiderEarning", 0] }
                            ]
                        } 
                    },
                    count: { $sum: 1 }
                } 
            }
        ]),
        riderOrders.aggregate([
            { 
                $match: { 
                    $and: [
                        {
                            $or: [
                                { 'dispatch.deliveryPartnerId': partnerId },
                                { 'dispatch.sharedPartnerId': partnerId }
                            ]
                        },
                        {
                            orderStatus: { 
                                $in: [
                                    'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop', 'delivered', 'completed',
                                    'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'REACHED_PICKUP', 'PICKED_UP', 'REACHED_DROP', 'DELIVERED', 'COMPLETED'
                                ] 
                            }
                        },
                        {
                            $or: [
                                { 'payment.method': { $in: ['cash', 'cod', 'CASH', 'COD'] } },
                                { 'paymentMethod': { $in: ['cash', 'cod', 'CASH', 'COD'] } },
                                { 
                                    $and: [
                                        { 'payment.method': { $exists: false } },
                                        { 'paymentMethod': { $exists: false } }
                                    ]
                                }
                            ]
                        }
                    ]
                } 
            },
            { 
                $group: { 
                    _id: null, 
                    actualCashCollected: { 
                        $sum: { 
                            $cond: [
                                { $in: ["$orderStatus", ["delivered", "completed", "DELIVERED", "COMPLETED"]] },
                                {
                                    $cond: [
                                        { $gt: [{ $ifNull: ["$amountToCollect", 0] }, 0] },
                                        "$amountToCollect",
                                        {
                                            $cond: [
                                                { $gt: [{ $ifNull: ["$payment.amountDue", 0] }, 0] },
                                                "$payment.amountDue",
                                                {
                                                    $cond: [
                                                        { $gt: [{ $ifNull: ["$payment.amount", 0] }, 0] },
                                                        "$payment.amount",
                                                        { $ifNull: ["$pricing.total", { $ifNull: ["$totalAmount", 0] }] }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                },
                                0
                            ]
                        } 
                    },
                    pendingCashLiability: { 
                        $sum: { 
                            $cond: [
                                { $not: { $in: ["$orderStatus", ["delivered", "completed", "DELIVERED", "COMPLETED"]] } },
                                {
                                    $cond: [
                                        { $gt: [{ $ifNull: ["$amountToCollect", 0] }, 0] },
                                        "$amountToCollect",
                                        {
                                            $cond: [
                                                { $gt: [{ $ifNull: ["$payment.amountDue", 0] }, 0] },
                                                "$payment.amountDue",
                                                {
                                                    $cond: [
                                                        { $gt: [{ $ifNull: ["$payment.amount", 0] }, 0] },
                                                        "$payment.amount",
                                                        { $ifNull: ["$pricing.total", { $ifNull: ["$totalAmount", 0] }] }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                },
                                0
                            ]
                        } 
                    }
                } 
            }
        ]),
        FoodDeliveryCashDeposit.aggregate([
            { $match: { deliveryPartnerId: partnerId, status: 'Completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: partnerId, status: 'credited' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        FoodDeliveryWithdrawal.aggregate([
            { $match: { deliveryPartnerId: partnerId, status: { $in: ['pending', 'approved', 'processed'] } } },
            { $group: { _id: '$status', total: { $sum: '$amount' } } }
        ]),
    ]);

    const totalEarned = Number(ordersRes[0]?.totalEarned || 0);
    const totalOrders = Number(ordersRes[0]?.count || 0);
    const actualCashCollected = Number(cashCollectedRes[0]?.actualCashCollected || 0);
    const pendingCashLiability = Number(cashCollectedRes[0]?.pendingCashLiability || 0);
    const totalCashDeposited = Number(depositsRes[0]?.total || 0);
    const totalBonus = Number(bonusRes[0]?.total || 0);

    const withdrawalsMap = (withdrawalsRes || []).reduce((acc, curr) => {
        acc[curr._id] = curr.total;
        return acc;
    }, {});

    const totalWithdrawn = Number(withdrawalsMap['approved'] || 0) + Number(withdrawalsMap['processed'] || 0);
    const pendingWithdrawals = Number(withdrawalsMap['pending'] || 0);

    const ledger = await getBalance('deliveryBoy', String(partnerId));

    // Lifetime Earnings = Total from orders + bonuses
    const lifetimeEarnings = totalEarned + totalBonus;
    
    // 1. Calculate raw earnings available for withdrawal/substitution
    const rawEarningsBalance = Math.max(0, lifetimeEarnings - (totalWithdrawn + pendingWithdrawals));
    const ledgerAvailable = Math.max(
        0,
        (Number(ledger.availableBalance) || 0) - pendingWithdrawals
    );
    
    // 2. Calculate actual cash in hand (already delivered - total deposited)
    const actualCashInHand = Math.max(0, actualCashCollected - totalCashDeposited);

    const pocketBalance = Math.max(rawEarningsBalance, ledgerAvailable);
    const netCashInHand = actualCashInHand;

    const totalCashLimit = Number(partner?.cashLimit || cashLimitSettings?.deliveryCashLimit) || 2000;
    const deliveryWithdrawalLimit = Number(cashLimitSettings?.deliveryWithdrawalLimit) || 100;

    const totalCurrentLiability = netCashInHand + pendingCashLiability;

    // Get transactions for UI (Orders, Bonuses, Withdrawals)
    const [ordersTx, withdrawalsList, depositList] = await Promise.all([
        riderOrders.find({ 
            $or: [
                { 'dispatch.deliveryPartnerId': partnerId },
                { 'dispatch.sharedPartnerId': partnerId }
            ],
            orderStatus: 'delivered' 
        })
            .sort({ createdAt: -1 })
            .select('orderId riderEarning sharedRiderEarning dispatch pricing settlementBreakdown payment orderStatus createdAt')
            .limit(20)
            .lean(),
        FoodDeliveryWithdrawal.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean(),
        FoodDeliveryCashDeposit.find({ deliveryPartnerId: partnerId })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean()
    ]);

    const transactions = [
        ...(ordersTx || []).map(o => {
            const earning = resolveRiderPayoutAmount(o, { partnerId });
            
            const collectedAmount = o.payment?.method === 'cash' || o.paymentMethod === 'cash'
                ? (o.amountToCollect || o.payment?.amountDue || o.pricing?.total || 0)
                : 0;

            return {
                id: o._id,
                type: 'payment',
                amount: Number(Number(earning).toFixed(2)),
                orderTotal: Number(Number(o.pricing?.total || 0).toFixed(2)),
                collectedAmount: Number(Number(collectedAmount).toFixed(2)),
                status: 'Completed',
                date: o.createdAt,
                description: o.payment?.method === 'cash' || o.paymentMethod === 'cash' ? 'COD delivery earning' : 'Online delivery earning',
                orderId: o.orderId || o._id
            };
        }),
        ...(withdrawalsList || []).map(w => ({
            id: w._id,
            type: 'withdrawal',
            amount: w.amount,
            status: w.status === 'pending' ? 'Pending' : (w.status === 'approved' ? 'Completed' : 'Rejected'),
            date: w.createdAt,
            description: `Withdrawal Request - ${w.paymentMethod}`,
            payoutMethod: w.paymentMethod
        })),
        ...(depositList || []).map(d => ({
            id: d._id,
            type: 'deposit',
            amount: d.amount,
            status: d.status || 'Pending',
            date: d.createdAt,
            description: 'Cash limit settlement',
            paymentMethod: d.paymentMethod || 'cash'
        }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Get last payout
    const lastWithdrawal = await FoodDeliveryWithdrawal.findOne({ 
        deliveryPartnerId: partnerId, 
        status: 'processed' 
    }).sort({ updatedAt: -1 }).lean();

    return {
        totalBalance: Number(rawEarningsBalance.toFixed(2)),
        pocketBalance: Number(pocketBalance.toFixed(2)),
        cashInHand: Number(actualCashInHand.toFixed(2)), // Show physical cash held
        netCashInHand: Number(netCashInHand.toFixed(2)), // For internal/admin reference
        totalActualCashCollected: Number(actualCashCollected.toFixed(2)),
        totalCashDeposited: Number(totalCashDeposited.toFixed(2)),
        totalEarned: Number(totalEarned.toFixed(2)),
        totalBonus: Number(totalBonus.toFixed(2)),
        totalWithdrawn: Number(totalWithdrawn.toFixed(2)),
        pendingWithdrawals: Number(pendingWithdrawals.toFixed(2)),
        totalOrders,
        lastPayout: lastWithdrawal ? {
            amount: Number(lastWithdrawal.amount.toFixed(2)),
            date: lastWithdrawal.updatedAt
        } : null,
        totalCashLimit: Number(totalCashLimit.toFixed(2)),
        availableCashLimit: Number(Math.max(0, totalCashLimit - totalCurrentLiability).toFixed(2)),
        deliveryWithdrawalLimit: Number(deliveryWithdrawalLimit.toFixed(2)),
        transactions: transactions.slice(0, 50)
    };
};

/**
 * Submits a new withdrawal request for a delivery partner.
 */
export const requestDeliveryWithdrawal = async (deliveryPartnerId, payload) => {
    const { amount, bankDetails, paymentMethod = 'bank_transfer' } = payload;
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
        throw new ValidationError('Invalid amount');
    }

    // Resolve partner for both legacy DELIVERY_PARTNER tokens and unified DRIVER tokens.
    let partner = null;
    if (deliveryPartnerId && mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        partner = await FoodDeliveryPartner.findById(deliveryPartnerId).lean();
        if (!partner) {
            partner = await FoodDeliveryPartner.findOne({ identityId: deliveryPartnerId }).lean();
        }
    }
    if (!partner) throw new ValidationError('Delivery partner not found');

    const partnerId = partner._id;
    const wallet = await getDeliveryPartnerWalletEnhanced(partnerId);
    if (numericAmount < wallet.deliveryWithdrawalLimit) {
        throw new ValidationError(`Minimum withdrawal amount is ₹${wallet.deliveryWithdrawalLimit}`);
    }
    if (numericAmount > wallet.pocketBalance) {
        throw new ValidationError('Insufficient balance for this withdrawal');
    }

    const pendingExists = await FoodDeliveryWithdrawal.exists({
        deliveryPartnerId: partnerId,
        status: 'pending',
    });
    if (pendingExists) {
        throw new ValidationError('You already have a pending withdrawal request');
    }

    const resolvedBankDetails = bankDetails || {
        accountNumber: partner.bankAccountNumber,
        ifscCode: partner.bankIfscCode,
        bankName: partner.bankName,
        accountHolderName: partner.bankAccountHolderName,
    };

    if (!resolvedBankDetails?.accountNumber) {
        throw new ValidationError('Please add bank details before requesting a withdrawal');
    }

    const withdrawal = await FoodDeliveryWithdrawal.create({
        deliveryPartnerId: partnerId,
        amount: numericAmount,
        paymentMethod,
        bankDetails: resolvedBankDetails,
        upiId: partner.upiId,
        upiQrCode: partner.upiQrCode,
        status: 'pending',
    });

    return withdrawal;
};

export const createDeliveryCashDepositOrder = async (deliveryPartnerId, amountInr) => {
    const amount = Number(amountInr);
    if (!Number.isFinite(amount) || amount < 1) {
        throw new ValidationError('Amount must be at least ₹1');
    }
    if (amount > 500000) {
        throw new ValidationError('Maximum deposit is ₹5,00,000');
    }

    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (amount > wallet.cashInHand) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    const amountPaise = Math.round(amount * 100);
    const receipt = `cash_deposit_${String(deliveryPartnerId).slice(-8)}_${Date.now()}`;

    if (!isRazorpayConfigured()) {
        // In production this must not silently hand back a stub — see the helper.
        assertRazorpayAvailableInProduction();
        return {
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId: `order_dev_${Date.now()}`,
                amount: amountPaise,
                currency: 'INR'
            }
        };
    }

    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);
    return {
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR'
        }
    };
};

export const verifyDeliveryCashDepositPayment = async (deliveryPartnerId, payload = {}) => {
    const orderId = String(payload?.razorpayOrderId || '').trim();
    const paymentId = String(payload?.razorpayPaymentId || '').trim();
    const signature = String(payload?.razorpaySignature || '').trim();
    const amount = Number(payload?.amount);

    if (!orderId) throw new ValidationError('razorpayOrderId is required');
    if (!paymentId) throw new ValidationError('razorpayPaymentId is required');
    if (!signature) throw new ValidationError('razorpaySignature is required');
    if (!Number.isFinite(amount) || amount < 1) throw new ValidationError('amount is required');

    const existing = await FoodDeliveryCashDeposit.findOne({
        deliveryPartnerId,
        $or: [
            { razorpayPaymentId: paymentId },
            { razorpayOrderId: orderId }
        ]
    }).lean();

    if (existing?.status === 'Completed') {
        return { deposit: existing, wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId) };
    }

    const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
    if (amount > wallet.cashInHand) {
        throw new ValidationError('Deposit amount cannot exceed cash in hand');
    }

    const isValid = isRazorpayConfigured()
        ? verifyPaymentSignature(orderId, paymentId, signature)
        : true;

    if (!isValid) {
        throw new ValidationError('Payment verification failed');
    }

    const deposit = existing
        ? await FoodDeliveryCashDeposit.findByIdAndUpdate(
            existing._id,
            {
                $set: {
                    amount,
                    paymentMethod: isRazorpayConfigured() ? 'razorpay' : 'cash',
                    status: 'Completed',
                    razorpayOrderId: orderId,
                    razorpayPaymentId: paymentId
                }
            },
            { new: true }
        )
        : await FoodDeliveryCashDeposit.create({
            deliveryPartnerId,
            amount,
            paymentMethod: isRazorpayConfigured() ? 'razorpay' : 'cash',
            status: 'Completed',
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId
        });

    return {
        deposit,
        wallet: await getDeliveryPartnerWalletEnhanced(deliveryPartnerId)
    };
};
