import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import { setActiveRole } from '../lib/profile';
import { errorText } from '../lib/errors';

type BaseVehicle = 'car' | 'motorcycle' | 'cargo';
type CarCategory = 'private' | 'taxi';

function computeVehicleType(base: BaseVehicle, cat: CarCategory | null): string {
  if (base === 'car') return cat === 'taxi' ? 'car_taxi' : 'car_private';
  if (base === 'motorcycle') return 'motorcycle';
  return 'cargo';
}

export default function DriverOnboardingPage() {
  const { t } = useTranslation();
  const nav = useNavigate();

  const [step, setStep] = React.useState(1);
  const [base, setBase] = React.useState<BaseVehicle>('car');
  const [carCat, setCarCat] = React.useState<CarCategory>('private');

  const [make, setMake] = React.useState('');
  const [model, setModel] = React.useState('');
  const [color, setColor] = React.useState('');
  const [plate, setPlate] = React.useState('');
  const [capacity, setCapacity] = React.useState<number>(4);

  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const backToRoleChooser = () => nav('/onboarding/role', { replace: true });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const uid = sess.session?.user.id;
      if (!uid) throw new Error('Not signed in');

      const vehicleType = computeVehicleType(base, base === 'car' ? carCat : null);

      // Upsert driver row (id = user id)
      const { error: dErr } = await supabase
        .from('drivers')
        .upsert({ id: uid, status: 'offline', vehicle_type: vehicleType }, { onConflict: 'id' });
      if (dErr) throw dErr;

      // Update or insert an active vehicle row
      const { data: existing, error: sErr } = await supabase
        .from('driver_vehicles')
        .select('id')
        .eq('driver_id', uid)
        .eq('is_active', true)
        .maybeSingle();
      if (sErr) throw sErr;

      if (existing?.id) {
        const { error: uErr } = await supabase
          .from('driver_vehicles')
          .update({
            make: make || null,
            model: model || null,
            color: color || null,
            plate_number: plate || null,
            capacity: Number.isFinite(capacity) ? capacity : null,
            vehicle_type: vehicleType,
          })
          .eq('id', existing.id);
        if (uErr) throw uErr;
      } else {
        const { error: iErr } = await supabase.from('driver_vehicles').insert({
          driver_id: uid,
          make: make || null,
          model: model || null,
          color: color || null,
          plate_number: plate || null,
          capacity: Number.isFinite(capacity) ? capacity : null,
          vehicle_type: vehicleType,
          is_active: true,
        });
        if (iErr) throw iErr;
      }

      await setActiveRole('driver');
      nav('/driver', { replace: true });
    } catch (e: any) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('onboarding.driverTitle')}</h1>
        <button className="btn" onClick={backToRoleChooser}>{t('common.back')}</button>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{err}</div>}

      <div className="mt-4 text-sm opacity-80">{t('onboarding.step', { step, total: 3 })}</div>

      {step === 1 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-semibold">{t('onboarding.vehicleType')}</div>
          <div className="grid gap-2 md:grid-cols-3">
            <button
              className={base === 'car' ? 'btn btn-primary' : 'btn'}
              onClick={() => setBase('car')}
              disabled={busy}
            >
              {t('driverVehicles.car')}
            </button>
            <button
              className={base === 'motorcycle' ? 'btn btn-primary' : 'btn'}
              onClick={() => setBase('motorcycle')}
              disabled={busy}
            >
              {t('driverVehicles.motorcycle')}
            </button>
            <button
              className={base === 'cargo' ? 'btn btn-primary' : 'btn'}
              onClick={() => setBase('cargo')}
              disabled={busy}
            >
              {t('driverVehicles.cargo')}
            </button>
          </div>

          {base === 'car' && (
            <div className="mt-4 space-y-2">
              <div className="text-sm font-semibold">{t('onboarding.carCategory')}</div>
              <div className="flex gap-2">
                <button
                  className={carCat === 'private' ? 'btn btn-primary' : 'btn'}
                  onClick={() => setCarCat('private')}
                  disabled={busy}
                >
                  {t('driverVehicles.private')}
                </button>
                <button
                  className={carCat === 'taxi' ? 'btn btn-primary' : 'btn'}
                  onClick={() => setCarCat('taxi')}
                  disabled={busy}
                >
                  {t('driverVehicles.taxi')}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={busy}>
              {t('common.continue')}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-6 space-y-3">
          <div className="text-sm font-semibold">{t('onboarding.vehicleDetails')}</div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <div className="mb-1 opacity-80">{t('vehicle.make')}</div>
              <input className="input w-full" value={make} onChange={(e) => setMake(e.target.value)} />
            </label>
            <label className="block text-sm">
              <div className="mb-1 opacity-80">{t('vehicle.model')}</div>
              <input className="input w-full" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="block text-sm">
              <div className="mb-1 opacity-80">{t('vehicle.color')}</div>
              <input className="input w-full" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            <label className="block text-sm">
              <div className="mb-1 opacity-80">{t('vehicle.plate')}</div>
              <input className="input w-full" value={plate} onChange={(e) => setPlate(e.target.value)} />
            </label>
            <label className="block text-sm">
              <div className="mb-1 opacity-80">{t('vehicle.capacity')}</div>
              <input
                className="input w-full"
                type="number"
                min={1}
                max={50}
                value={capacity}
                onChange={(e) => setCapacity(parseInt(e.target.value || '0', 10))}
              />
            </label>
          </div>

          <div className="mt-6 flex justify-between">
            <button className="btn" onClick={() => setStep(1)} disabled={busy}>
              {t('common.back')}
            </button>
            <button className="btn btn-primary" onClick={() => setStep(3)} disabled={busy}>
              {t('common.continue')}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-semibold">{t('onboarding.review')}</div>
            <div className="mt-2 text-sm opacity-80">
              <div>
                {t('onboarding.vehicleType')}: <span className="font-medium">{computeVehicleType(base, base === 'car' ? carCat : null)}</span>
              </div>
              <div className="mt-1">
                {t('vehicle.make')}: <span className="font-medium">{make || '-'}</span>
              </div>
              <div className="mt-1">
                {t('vehicle.model')}: <span className="font-medium">{model || '-'}</span>
              </div>
              <div className="mt-1">
                {t('vehicle.color')}: <span className="font-medium">{color || '-'}</span>
              </div>
              <div className="mt-1">
                {t('vehicle.plate')}: <span className="font-medium">{plate || '-'}</span>
              </div>
              <div className="mt-1">
                {t('vehicle.capacity')}: <span className="font-medium">{Number.isFinite(capacity) ? capacity : '-'}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button className="btn" onClick={() => setStep(2)} disabled={busy}>
              {t('common.back')}
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? t('common.working') : t('onboarding.finish')}
            </button>
          </div>

          <div className="mt-3 text-xs opacity-70">{t('onboarding.driverKycHint')}</div>
        </div>
      )}
    </div>
  );
}
