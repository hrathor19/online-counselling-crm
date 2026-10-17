'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Clock3, MapPin, Save, Crosshair, Info, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface Policy {
  lateCutoffEnabled: boolean;
  lateCutoffHour: number;
  lateCutoffMinute: number;
  geofenceEnabled: boolean;
  officeLatitude: number | null;
  officeLongitude: number | null;
  geofenceRadiusM: number;
  updatedAt: string | null;
}
interface Payload {
  policy: Policy;
  updatedByName: string | null;
  today: { onTime: number; late: number; notCheckedIn: number; agentCount: number };
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

export default function AttendancePolicyPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ['attendance-policy'],
    queryFn: () => fetch('/api/super-admin/attendance-policy').then((r) => r.json()),
  });

  const [form, setForm] = useState<Policy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [locating, setLocating] = useState(false);

  // Seeded once the server answers, then left alone — a background refetch
  // must not wipe half-finished edits.
  useEffect(() => {
    if (!data || dirty) return;
    setForm(data.policy);
  }, [data, dirty]);

  const edit = (fn: (p: Policy) => Policy) => {
    setForm((cur) => (cur ? fn(cur) : cur));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/super-admin/attendance-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = typeof j.error === 'string'
          ? j.error
          : j.error?.fieldErrors?.officeLatitude?.[0] ?? 'Could not save the policy';
        throw new Error(msg);
      }
      return j;
    },
    onSuccess: () => {
      toast({ title: 'Attendance policy saved' });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['attendance-policy'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
  });

  /** Reads the admin's own position and makes it the office. */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast({ variant: 'destructive', title: 'Not supported', description: 'This browser cannot report a location.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        edit((p) => ({
          ...p,
          officeLatitude: Number(pos.coords.latitude.toFixed(6)),
          officeLongitude: Number(pos.coords.longitude.toFixed(6)),
        }));
        toast({
          title: 'Office location set',
          description: `Accurate to about ${Math.round(pos.coords.accuracy)}m.`,
        });
      },
      (err) => {
        setLocating(false);
        toast({
          variant: 'destructive',
          title: 'Could not read your location',
          // Permission is the usual cause and the only one the admin can fix.
          description: err.code === err.PERMISSION_DENIED
            ? 'Allow location access for this site and try again.'
            : err.message,
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  if (isLoading || !form) {
    return <div className="mx-auto max-w-3xl space-y-3 py-2">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>;
  }

  const t = data!.today;

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-lg">
          <Clock3 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance Policy</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            When the working day starts, and where the floor may check in from.
          </p>
        </div>
      </div>

      {/* Today at a glance */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'On time', value: t.onTime, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Late', value: t.late, tone: 'text-amber-600 dark:text-amber-400' },
          { label: 'Not checked in', value: t.notCheckedIn, tone: 'text-muted-foreground' },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl border border-border/60 bg-card p-4">
            <p className={cn('text-2xl font-bold tabular-nums', c.tone)}>{c.value}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ── Late cutoff ─────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-sm font-semibold">Late check-in cutoff</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {form.lateCutoffEnabled
                ? <>On. An agent checking in after <strong>{hhmm(form.lateCutoffHour, form.lateCutoffMinute)}</strong> gets no fresh leads today — only leads that already carry feedback.</>
                : 'Off. Every agent can receive any lead, whenever they check in.'}
            </p>
          </div>
          <Switch
            checked={form.lateCutoffEnabled}
            onCheckedChange={(v) => edit((p) => ({ ...p, lateCutoffEnabled: v }))}
          />
        </div>

        {form.lateCutoffEnabled && (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Cutoff time (IST)</Label>
              <Input
                type="time"
                className="h-9 w-36"
                value={hhmm(form.lateCutoffHour, form.lateCutoffMinute)}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number);
                  if (Number.isFinite(h) && Number.isFinite(m)) {
                    edit((p) => ({ ...p, lateCutoffHour: h, lateCutoffMinute: m }));
                  }
                }}
              />
            </div>
            <p className="pb-2 text-[11px] text-muted-foreground">
              Checking in exactly at {hhmm(form.lateCutoffHour, form.lateCutoffMinute)} counts as on time.
            </p>
          </div>
        )}
      </div>

      {/* ── Geofence ────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-sm font-semibold">Check-in location</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {form.geofenceEnabled
                ? <>On. WFO staff must be within <strong>{form.geofenceRadiusM}m</strong> of the office to check in.</>
                : 'Off. Staff can check in from anywhere.'}
            </p>
          </div>
          <Switch
            checked={form.geofenceEnabled}
            onCheckedChange={(v) => edit((p) => ({ ...p, geofenceEnabled: v }))}
          />
        </div>

        {form.geofenceEnabled && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Latitude</Label>
                <Input
                  className="h-9 w-40 font-mono text-xs"
                  value={form.officeLatitude ?? ''}
                  onChange={(e) => edit((p) => ({ ...p, officeLatitude: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="28.613900"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Longitude</Label>
                <Input
                  className="h-9 w-40 font-mono text-xs"
                  value={form.officeLongitude ?? ''}
                  onChange={(e) => edit((p) => ({ ...p, officeLongitude: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="77.209000"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Radius (m)</Label>
                <Input
                  type="number" min={50} max={50000}
                  className="h-9 w-28"
                  value={form.geofenceRadiusM}
                  onChange={(e) => edit((p) => ({ ...p, geofenceRadiusM: Number(e.target.value) }))}
                />
              </div>
              <Button type="button" variant="outline" onClick={useMyLocation} disabled={locating} className="h-9">
                {locating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Crosshair className="mr-2 h-4 w-4" />}
                Use my current location
              </Button>
            </div>

            {form.officeLatitude !== null && form.officeLongitude !== null && (
              <a
                href={`https://www.google.com/maps?q=${form.officeLatitude},${form.officeLongitude}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
              >
                <MapPin className="h-3 w-3" />
                Check this point on the map
              </a>
            )}

            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              WFH staff are exempt — they must still check in, but from anywhere. Blocking them on
              location would lock them out of the CRM entirely, since lead work needs a check-in.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          <Users className="mr-1 inline h-3 w-3" />
          {data!.today.agentCount} active counsellor{data!.today.agentCount === 1 ? '' : 's'}.
          {data!.updatedByName && <> Last changed by {data!.updatedByName}.</>}
        </p>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-4 text-[11px] text-muted-foreground">
        <Info className="mt-px h-3 w-3 shrink-0" />
        Lateness is stamped at check-in and never recalculated, so moving the cutoff later today does
        not retroactively clear this morning&apos;s late marks. An agent who has not checked in at all is
        treated the same as a late one: no fresh leads, and re-assignment rules skip them.
      </p>
    </div>
  );
}
