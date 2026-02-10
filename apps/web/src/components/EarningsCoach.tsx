import React from 'react';
import { formatIQD } from '../lib/money';

export default function EarningsCoach() {
    const [goal] = React.useState(250000);
    const current = 145000;
    const progress = Math.min(100, (current / goal) * 100);

    return (
        <div className="card p-5 bg-gradient-to-br from-indigo-900 to-indigo-800 text-white border-none shadow-xl">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="font-bold text-lg">Earnings Goal</h3>
                    <div className="text-indigo-200 text-sm">Weekly Target</div>
                </div>
                <div className="bg-indigo-700/50 p-2 rounded-lg text-center">
                    <div className="text-xs text-indigo-200 uppercase tracking-wider">Coach Tip</div>
                    <div className="text-sm font-medium">Drive Friday 6-9pm!</div>
                </div>
            </div>

            <div className="mb-2 flex items-end gap-2">
                <span className="text-3xl font-bold">{formatIQD(current)}</span>
                <span className="text-indigo-300 text-sm mb-1">/ {formatIQD(goal)}</span>
            </div>

            <div className="h-3 bg-indigo-950/50 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-indigo-300 mt-2 text-right">
                {Math.round(progress)}% completed
            </div>
        </div>
    );
}
