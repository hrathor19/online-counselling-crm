'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { SearchableSelect, type SearchableSelectOption } from '@/components/shared/searchable-select';

/**
 * Add Single Lead, in one place.
 *
 * Opened from the + in the header on every page, and from the Upload Leads
 * page. Both used to be the same markup written twice; a field added to one
 * and not the other is the kind of drift that ends with two forms disagreeing
 * about what a lead needs.
 *
 * The eight fields match the CSV template exactly — Name, Email, Phone, City,
 * State, Course, College, Lead Source — so a lead typed in here and a lead
 * imported from a file are the same shape.
 */

const singleLeadSchema = z.object({
  name:     z.string().min(1, 'Name is required'),
  email:    z.string().email('Invalid email'),
  phone:    z.string().min(1, 'Phone is required'),
  college:  z.string().min(1, 'College is required'),
  city:     z.string().optional(),
  state:    z.string().optional(),
  course:   z.string().optional(),
  campaign: z.string().optional(),
});
export type SingleLeadForm = z.infer<typeof singleLeadSchema>;

/** What POST /api/leads answers with — a new lead, or a merge onto an existing one. */
interface AddLeadResponse {
  id?: string;
  name?: string;
  college?: string | null;
  merged?: boolean;
  interestCount?: number;
  assignedToSelf?: boolean;
  error?: unknown;
}

export function AddLeadDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors },
  } = useForm<SingleLeadForm>({ resolver: zodResolver(singleLeadSchema) });

  // staleTime: Infinity — reference data that does not change within a
  // session, and these queryKeys are shared with the Upload Leads page, so
  // opening this dialog after visiting that page costs no extra requests.
  // `enabled: open` keeps them off the wire entirely until the + is clicked:
  // the header renders on every page, and the college list is not small.
  const { data: collegesRaw } = useQuery<{ id: string; value: string }[]>({
    queryKey: ['dropdown-colleges'],
    queryFn: () => fetch('/api/dropdown-options?type=COLLEGE').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: citiesRaw } = useQuery({
    queryKey: ['locations-city'],
    queryFn: () => fetch('/api/locations?type=city').then((r) => r.json()).catch(() => null),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: statesRaw } = useQuery({
    queryKey: ['locations-state'],
    queryFn: () => fetch('/api/locations?type=state').then((r) => r.json()).catch(() => null),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: coursesRaw } = useQuery<{ id: number | string; name: string }[]>({
    queryKey: ['static-courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])).catch(() => []),
    staleTime: Infinity,
    enabled: open,
  });

  // The Lead model stores these as plain strings, so each option's value IS
  // the display name — exactly what CSV upload stores.
  const cityOptions = useMemo<SearchableSelectOption[]>(
    () => ((citiesRaw?.data ?? []) as { city_name: string }[]).map((c) => ({ value: c.city_name, label: c.city_name })),
    [citiesRaw],
  );
  const stateOptions = useMemo<SearchableSelectOption[]>(
    () => ((statesRaw?.data ?? []) as { name: string }[]).map((s) => ({ value: s.name, label: s.name })),
    [statesRaw],
  );
  const courseOptions = useMemo<SearchableSelectOption[]>(
    () => (coursesRaw ?? []).map((c) => ({ value: c.name, label: c.name })),
    [coursesRaw],
  );
  const collegeOptions = useMemo<SearchableSelectOption[]>(
    () => (collegesRaw ?? []).map((c) => ({ value: c.value, label: c.value })),
    [collegesRaw],
  );

  // Clear on close so the next open is a blank form rather than the last
  // lead's details — two leads added back to back is the normal case here.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const mutation = useMutation<AddLeadResponse, Error, SingleLeadForm>({
    mutationFn: (data) =>
      fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          // The API says "already enquired about that college and course" on a
          // 409 and "Forbidden" on a 403 — both are worth showing verbatim
          // rather than a generic failure.
          throw new Error(
            typeof body?.error === 'string' ? body.error : 'Could not add this lead. Please try again.',
          );
        }
        return body as AddLeadResponse;
      }),
    onSuccess: (data) => {
      // A merge created nothing — saying "Lead added" would have the operator
      // looking for a new row that does not exist.
      if (data.merged) {
        toast({
          title: 'Added to an existing lead',
          description: `${data.name} had already enquired, so ${data.college} was added to their interests (${data.interestCount} in total).`,
        });
      } else {
        toast({
          title: 'Lead added',
          description: data.assignedToSelf
            ? `${data.name} is in your queue and ready to call.`
            : `${data.name} has been added and is waiting to be assigned.`,
        });
      }
      // Every list that could now be out of date. The + is reachable from any
      // page, so there is no single list to refresh.
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['upload-batches'] });
      onOpenChange(false);
      reset();
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Failed to add lead', description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Single Lead</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input {...register('name')} placeholder="Full name" autoFocus />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input {...register('email')} type="email" placeholder="email@example.com" />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Phone <span className="text-destructive">*</span></Label>
              <Input {...register('phone')} placeholder="10-digit phone" />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <SearchableSelect
                options={cityOptions}
                value={watch('city') ?? ''}
                onChange={(v) => setValue('city', v, { shouldValidate: true })}
                placeholder="— Select City —"
              />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <SearchableSelect
                options={stateOptions}
                value={watch('state') ?? ''}
                onChange={(v) => setValue('state', v, { shouldValidate: true })}
                placeholder="— Select State —"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <SearchableSelect
                options={courseOptions}
                value={watch('course') ?? ''}
                onChange={(v) => setValue('course', v, { shouldValidate: true })}
                placeholder="— Select Course —"
              />
            </div>
            <div className="space-y-1.5">
              <Label>College <span className="text-destructive">*</span></Label>
              <SearchableSelect
                options={collegeOptions}
                value={watch('college') ?? ''}
                onChange={(v) => setValue('college', v, { shouldValidate: true })}
                placeholder="— Select College —"
              />
              {errors.college && <p className="text-xs text-destructive">{errors.college.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Lead Source</Label>
              <Input {...register('campaign')} placeholder="e.g. Google_Ads" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
