import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@shared/components/ui/Toast';
import { adminApi } from '../services/adminApi';

const TABS = [
    { id: 'dispatch', label: 'Dispatch & Payments' },
    { id: 'speed', label: 'Delivery Speed' },
    { id: 'sharing', label: 'Sharing & Multi-store' },
];

const SPEED_ICONS = ['bike', 'leaf', 'zap', 'truck', 'clock'];

const emptySpeedOption = (index) => ({
    id: `option-${index + 1}`,
    name: '',
    badge: '',
    badgeColor: 'bg-slate-100 text-slate-700 border border-slate-200',
    time: '',
    estimatedTime: 30,
    feeModifier: 0,
    driverShareAmount: 0,
    description: '',
    icon: 'bike',
    isEnabled: true,
    isDefault: false,
    sortOrder: index,
});

const inputClass =
    'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500';

function Toggle({ checked, onChange, disabled }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(!checked)}
            aria-pressed={checked}
            className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60',
                checked ? 'bg-emerald-600' : 'bg-slate-300',
            )}
        >
            <span
                className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    checked ? 'translate-x-6' : 'translate-x-1',
                )}
            />
        </button>
    );
}

function Field({ label, hint, children }) {
    return (
        <label className="block space-y-1">
            <span className="block text-xs font-bold uppercase text-slate-500">{label}</span>
            {children}
            {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
        </label>
    );
}

function Section({ title, description, children }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
            <div className="mt-4 space-y-4">{children}</div>
        </div>
    );
}

/**
 * Admin page for Quick Commerce delivery behaviour - the Quick Commerce counterpart of Food's
 * Fee Settings > Delivery Speed / Partner Settings. Everything here is read live by the order flow.
 */
export default function DeliverySettings() {
    const { showToast } = useToast();
    const [settings, setSettings] = useState(null);
    const [tab, setTab] = useState('dispatch');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const response = await adminApi.getDeliverySettings();
            setSettings(response.data?.data?.settings || response.data?.settings || {});
        } catch (error) {
            showToast(error?.response?.data?.message || 'Failed to load delivery settings', 'error');
        }
    }, [showToast]);

    useEffect(() => {
        load();
    }, [load]);

    const update = (patch) => setSettings((prev) => ({ ...prev, ...patch }));
    const num = (field) => (event) => update({ [field]: event.target.value });

    const save = async () => {
        setSaving(true);
        try {
            const response = await adminApi.updateDeliverySettings(settings);
            setSettings(response.data?.data?.settings || settings);
            showToast('Delivery settings saved', 'success');
        } catch (error) {
            showToast(error?.response?.data?.message || 'Failed to save delivery settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!settings) {
        return (
            <div className="flex min-h-[300px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
        );
    }

    const options = Array.isArray(settings.deliverySpeedOptions) ? settings.deliverySpeedOptions : [];
    const updateOption = (index, patch) =>
        update({
            deliverySpeedOptions: options.map((option, i) => {
                if (i !== index) return patch.isDefault ? { ...option, isDefault: false } : option;
                return { ...option, ...patch };
            }),
        });

    return (
        <div className="space-y-6 pb-12">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">Delivery &amp; Dispatch</h1>
                    <p className="text-sm text-slate-500">How Quick Commerce orders reach riders, stores and customers.</p>
                </div>
                <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save changes
                </button>
            </div>

            <div className="flex flex-wrap gap-2">
                {TABS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={cn(
                            'rounded-lg px-4 py-2 text-sm font-semibold',
                            tab === item.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === 'dispatch' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Section title="Payments" description="Food has Cash on Delivery switched off; Quick Commerce follows unless you turn it on here.">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Allow Cash on Delivery</span>
                            <Toggle checked={Boolean(settings.codEnabled)} onChange={(value) => update({ codEnabled: value })} />
                        </div>
                    </Section>

                    <Section title="Rider search" description="How an order is offered to delivery partners.">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Offer window (sec)" hint="Time a rider has to accept">
                                <input type="number" min="15" max="180" className={inputClass} value={settings.offerTimeoutSec ?? ''} onChange={num('offerTimeoutSec')} />
                            </Field>
                            <Field label="Broadcast from round" hint="Earlier rounds offer to the 3 nearest riders">
                                <input type="number" min="1" max="10" className={inputClass} value={settings.broadcastFromAttempt ?? ''} onChange={num('broadcastFromAttempt')} />
                            </Field>
                            <Field label="Alert admin from round">
                                <input type="number" min="1" max="20" className={inputClass} value={settings.adminAlertFromAttempt ?? ''} onChange={num('adminAlertFromAttempt')} />
                            </Field>
                            <Field label="Max search rounds">
                                <input type="number" min="1" max="30" className={inputClass} value={settings.maxDispatchAttempts ?? ''} onChange={num('maxDispatchAttempts')} />
                            </Field>
                            <Field label="Cancel if no rider (min)" hint="Order is cancelled and refunded">
                                <input type="number" min="1" max="120" className={inputClass} value={settings.noRiderCancelMinutes ?? ''} onChange={num('noRiderCancelMinutes')} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="Store response" description="After a rider accepts, the store must accept too.">
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Remind store after (min)">
                                <input type="number" min="1" max="30" className={inputClass} value={settings.sellerAckResendMinutes ?? ''} onChange={num('sellerAckResendMinutes')} />
                            </Field>
                            <Field label="Auto-cancel after (min)" hint="Refunds the customer, frees the rider">
                                <input type="number" min="2" max="60" className={inputClass} value={settings.sellerAckTimeoutMinutes ?? ''} onChange={num('sellerAckTimeoutMinutes')} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="Scheduled orders">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Allow customers to schedule</span>
                            <Toggle checked={settings.scheduleEnabled !== false} onChange={(value) => update({ scheduleEnabled: value })} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Go live before (min)">
                                <input type="number" min="5" max="240" className={inputClass} value={settings.scheduleLeadMinutes ?? ''} onChange={num('scheduleLeadMinutes')} />
                            </Field>
                            <Field label="Earliest slot (min)">
                                <input type="number" min="5" max="240" className={inputClass} value={settings.scheduleMinAheadMinutes ?? ''} onChange={num('scheduleMinAheadMinutes')} />
                            </Field>
                            <Field label="Up to (days)">
                                <input type="number" min="1" max="30" className={inputClass} value={settings.scheduleMaxDays ?? ''} onChange={num('scheduleMaxDays')} />
                            </Field>
                        </div>
                    </Section>
                </div>
            ) : null}

            {tab === 'speed' ? (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-slate-600">
                            Options the customer can pick at checkout. A positive fee is charged on top of the delivery fee; a negative one is a
                            discount the platform absorbs. The rider gets the share you set, up to the fee.
                        </p>
                        <button
                            type="button"
                            onClick={() => update({ deliverySpeedOptions: [...options, emptySpeedOption(options.length)] })}
                            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                        >
                            <Plus className="h-4 w-4" /> Add option
                        </button>
                    </div>
                    {options.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                            No speed options configured. Customers see the standard delivery only.
                        </div>
                    ) : null}
                    {options.map((option, index) => (
                        <div key={`${option.id}-${index}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                                <Field label="Name">
                                    <input className={inputClass} value={option.name} onChange={(e) => updateOption(index, { name: e.target.value })} placeholder="Express" />
                                </Field>
                                <Field label="Id">
                                    <input className={inputClass} value={option.id} onChange={(e) => updateOption(index, { id: e.target.value })} />
                                </Field>
                                <Field label="Time label">
                                    <input className={inputClass} value={option.time} onChange={(e) => updateOption(index, { time: e.target.value })} placeholder="10-15 mins" />
                                </Field>
                                <Field label="ETA (minutes)">
                                    <input type="number" min="1" className={inputClass} value={option.estimatedTime} onChange={(e) => updateOption(index, { estimatedTime: e.target.value })} />
                                </Field>
                                <Field label="Fee change (Rs)">
                                    <input type="number" className={inputClass} value={option.feeModifier} onChange={(e) => updateOption(index, { feeModifier: e.target.value })} />
                                </Field>
                                <Field label="Rider share (Rs)" hint="Only for a positive fee">
                                    <input type="number" min="0" className={inputClass} value={option.driverShareAmount} onChange={(e) => updateOption(index, { driverShareAmount: e.target.value })} />
                                </Field>
                                <Field label="Badge">
                                    <input className={inputClass} value={option.badge} onChange={(e) => updateOption(index, { badge: e.target.value })} placeholder="Fastest" />
                                </Field>
                                <Field label="Icon">
                                    <select className={inputClass} value={option.icon} onChange={(e) => updateOption(index, { icon: e.target.value })}>
                                        {SPEED_ICONS.map((icon) => (
                                            <option key={icon} value={icon}>{icon}</option>
                                        ))}
                                    </select>
                                </Field>
                                <div className="md:col-span-4">
                                    <Field label="Description">
                                        <input className={inputClass} value={option.description} onChange={(e) => updateOption(index, { description: e.target.value })} />
                                    </Field>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-2 text-sm text-slate-700">
                                        <Toggle checked={option.isEnabled !== false} onChange={(value) => updateOption(index, { isEnabled: value })} /> Enabled
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-slate-700">
                                        <input type="radio" name="default-speed" checked={Boolean(option.isDefault)} onChange={() => updateOption(index, { isDefault: true })} />
                                        Pre-selected
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => update({ deliverySpeedOptions: options.filter((_, i) => i !== index) })}
                                    className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600"
                                >
                                    <Trash2 className="h-4 w-4" /> Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}

            {tab === 'sharing' ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Section title="Split large orders" description="At or above the item count the delivery fee and the rider payout are doubled, and the rider can ask for a second rider.">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Enable split delivery for large carts</span>
                            <Toggle checked={settings.splitOrderEnabled !== false} onChange={(value) => update({ splitOrderEnabled: value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Field label="Item count threshold">
                                <input type="number" min="1" className={inputClass} value={settings.splitOrderThreshold ?? ''} onChange={num('splitOrderThreshold')} />
                            </Field>
                            <Field label="Wait for 2nd rider (min)" hint="After this the first rider may finish alone">
                                <input type="number" min="1" max="60" className={inputClass} value={settings.shareTimeoutMinutes ?? ''} onChange={num('shareTimeoutMinutes')} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="Several stores in one order" description="Off by default: a Quick Commerce order has always been from a single store.">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">Allow items from more than one store</span>
                            <Toggle checked={Boolean(settings.multiOrderEnabled)} onChange={(value) => update({ multiOrderEnabled: value })} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <Field label="Max stores">
                                <select className={inputClass} value={settings.maxSellersPerOrder ?? 2} onChange={num('maxSellersPerOrder')}>
                                    <option value={2}>2</option>
                                    <option value={3}>3</option>
                                </select>
                            </Field>
                            <Field label="Max distance apart (km)">
                                <input type="number" min="1" max="10" step="0.5" className={inputClass} value={settings.multiOrderMaxDistance ?? ''} onChange={num('multiOrderMaxDistance')} />
                            </Field>
                            <Field label="Extra charge (Rs)" hint="Added for each multi-store order">
                                <input type="number" min="0" className={inputClass} value={settings.multiOrderAdditionalCharge ?? ''} onChange={num('multiOrderAdditionalCharge')} />
                            </Field>
                        </div>
                    </Section>

                    <Section title="Rider order stacking" description="How many orders one rider may carry at once is shared with Food (Food admin > Fee Settings > Partner Settings), because it is the same fleet.">
                        <p className="text-sm text-slate-500">Nothing to set here.</p>
                    </Section>
                </div>
            ) : null}
        </div>
    );
}
