import React from 'react';
import { useQuery } from '@tanstack/react-query';

// import { invokeEdge } from '../lib/edgeInvoke';
import { formatIQD } from '../lib/money';

type ForecastSlot = {
    day: string;
    hour_start: number;
    hour_end: number;
    demand_score: number; // 0-100
    expected_hourly_earnings_iqd: number;
};

export default function ShiftPlanner() {

    const forecasts = useQuery({
        queryKey: ['shift_forecasts'],
        queryFn: async () => {
            // Mocked response logic until edge function is confirmed live with data
            // const { data } = await invokeEdge<{ slots: ForecastSlot[] }>('shift-planner', {});
            // return data.slots;

            // Mock data for UI preview
            return [
                { day: 'Today', hour_start: 18, hour_end: 21, demand_score: 95, expected_hourly_earnings_iqd: 25000 },
                { day: 'Today', hour_start: 21, hour_end: 23, demand_score: 80, expected_hourly_earnings_iqd: 18000 },
                { day: 'Tomorrow', hour_start: 7, hour_end: 10, demand_score: 90, expected_hourly_earnings_iqd: 22000 },
            ] as ForecastSlot[];
        }
    });

    return (
        <div className="card p-5">
            <h3 className="font-semibold mb-3">Shift Planner</h3>
            <div className="text-sm text-gray-500 mb-4">
                Plan your week around high demand times to maximize earnings.
            </div>

            {forecasts.isLoading && <div className="text-sm text-gray-500">Loading forecasts...</div>}

            <div className="space-y-3">
                {(forecasts.data ?? []).map((slot: ForecastSlot, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl hover:bg-gray-50">
                        <div>
                            <div className="font-medium">{slot.day} • {slot.hour_start}:00 - {slot.hour_end}:00</div>
                            <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                                <span className={`px-1.5 rounded text-[10px] font-bold ${slot.demand_score > 90 ? 'bg-red-100 text-red-700' :
                                    slot.demand_score > 70 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
                                    }`}>
                                    {slot.demand_score > 90 ? 'VERY BUSY' : slot.demand_score > 70 ? 'BUSY' : 'NORMAL'}
                                </span>
                                <span>Est. {formatIQD(slot.expected_hourly_earnings_iqd)}/hr</span>
                            </div>
                        </div>
                        <button className="btn text-xs px-3 py-1.5 h-auto min-h-0">
                            Remind Me
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
