import React from 'react';

type Props = {
    rideStatus: string;
    driverName?: string | null;
    vehicle?: string | null;
    etaMinutes?: number | null;
    className?: string;
};

export default function LiveActivitySimulator({ rideStatus, driverName, vehicle, etaMinutes, className }: Props) {

    if (!['assigned', 'arrived', 'in_progress'].includes(rideStatus)) return null;

    return (
        <div className={`bg-black text-white rounded-3xl p-4 w-full max-w-sm mx-auto shadow-2xl border border-gray-800 ${className}`}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-xs font-bold">
                        IQ
                    </div>
                    <div className="text-sm font-medium">RideIQ • {rideStatus === 'in_progress' ? 'On Trip' : 'Pickup'}</div>
                </div>
                <div className="text-xs text-gray-400">Live Activity</div>
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-2xl font-bold font-mono">
                            {etaMinutes ? `${etaMinutes} min` : '--'}
                        </div>
                        <div className="text-xs text-gray-400 uppercase tracking-wider">
                            {rideStatus === 'in_progress' ? 'To Destination' : 'Driver Arriving'}
                        </div>
                    </div>

                    <div className="text-right">
                        <div className="text-lg font-semibold">{driverName || 'Driver'}</div>
                        <div className="text-sm text-gray-400">{vehicle || 'Vehicle'}</div>
                    </div>
                </div>

                {/* Progress Bar Simulation */}
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-indigo-500 transition-all duration-1000"
                        style={{
                            width: rideStatus === 'arrived' ? '100%' : rideStatus === 'in_progress' ? '50%' : '15%'
                        }}
                    />
                </div>

                <div className="text-center text-xs text-gray-500 pt-2">
                    Lock Screen Preview (iOS style)
                </div>
            </div>
        </div>
    );
}
