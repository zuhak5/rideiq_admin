import React from 'react';
import { formatIQD } from '../lib/money';


type Props = {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    smallOrderFee?: number;
    discount?: number;
};

export default function FeeBreakdown({ subtotal, deliveryFee, serviceFee, smallOrderFee = 0, discount = 0 }: Props) {

    const total = subtotal + deliveryFee + serviceFee + smallOrderFee - discount;
    const isFreeDelivery = deliveryFee === 0;

    return (
        <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatIQD(subtotal)}</span>
            </div>

            <div className="flex justify-between text-gray-600">
                <span className="flex items-center gap-1">
                    Delivery Fee
                    {isFreeDelivery && <span className="text-xs bg-emerald-100 text-emerald-700 px-1 rounded">FREE</span>}
                </span>
                <span className={isFreeDelivery ? 'line-through text-gray-400' : ''}>
                    {isFreeDelivery ? formatIQD(2500) : formatIQD(deliveryFee)}
                </span>
            </div>

            <div className="flex justify-between text-gray-600">
                <span>Service Fee</span>
                <span>{formatIQD(serviceFee)}</span>
            </div>

            {smallOrderFee > 0 && (
                <div className="flex justify-between text-orange-600">
                    <span>Small Order Fee</span>
                    <span>{formatIQD(smallOrderFee)}</span>
                </div>
            )}

            {discount > 0 && (
                <div className="flex justify-between text-emerald-600 font-medium">
                    <span>Discount</span>
                    <span>-{formatIQD(discount)}</span>
                </div>
            )}

            <div className="pt-2 border-t border-gray-100 flex justify-between font-bold text-base mt-2">
                <span>Total</span>
                <span>{formatIQD(total)}</span>
            </div>
        </div>
    );
}
