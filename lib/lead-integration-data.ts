import type { Lead, LeadProfile } from '@prisma/client';
import { resolveCityId, resolveStateId } from '@/lib/lms-location-lookup';
import { resolveCourseGroupId } from '@/lib/lms-course-lookup';

// Server-only: resolves cityId/stateId/courseId against the LMS's live
// unified-data API, so this must never be imported from a 'use client'
// component (that chain eventually reaches lib/lms-api.ts's hardcoded API
// key). The static, client-safe field catalog/sample data live in
// lib/lead-integration-fields.ts.

/** The relations buildLeadTemplateData reads — every caller loads a lead with exactly this. */
export const LEAD_TEMPLATE_INCLUDE = {
  profile: true,
  referredBy: { select: { id: true, name: true, phone: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true, employeeCode: true } },
} as const;

export type LeadForTemplate = Lead & {
  profile?: LeadProfile | null;
  referredBy?: { id?: string; name: string; phone?: string | null; email?: string | null } | null;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
    employeeCode: string | null;
  } | null;
};

/** Flattens a fetched lead (+ relations) into the flat key/value shape FIELD_CATALOG describes. */
export async function buildLeadTemplateData(lead: LeadForTemplate): Promise<Record<string, unknown>> {
  const profile = lead.profile;
  const [cityId, stateId, courseId] = await Promise.all([
    resolveCityId(lead.city),
    resolveStateId(lead.state),
    resolveCourseGroupId(lead.course),
  ]);

  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    cityId,
    stateId,
    course: lead.course,
    courseId,
    college: lead.college,
    kappCollegeId: lead.kappCollegeId,
    campaign: lead.campaign,
    leadType: lead.leadType,
    leadOrigin: lead.leadOrigin,
    leadZone: lead.leadZone,
    category: lead.category,
    gender: lead.gender,
    classYear: lead.classYear,
    parentName: lead.parentName,
    parentMobile: lead.parentMobile,
    altEmail1: lead.altEmail1,
    altEmail2: lead.altEmail2,
    altPhone1: lead.altPhone1,
    altPhone2: lead.altPhone2,
    correctCity: lead.correctCity,
    correctState: lead.correctState,
    createdAt: lead.createdAt?.toISOString(),
    // Who referred this lead — all empty on a lead that did not come by referral.
    isReferral: lead.referredById ? 'Yes' : 'No',
    referredBy_id: lead.referredBy?.id ?? lead.referredById ?? null,
    referredBy_name: lead.referredBy?.name ?? null,
    referredBy_phone: lead.referredBy?.phone ?? null,
    referredBy_email: lead.referredBy?.email ?? null,

    // Every agent identifier the receiving system might key on. Null on an
    // unassigned lead — the template renderer turns that into an empty string.
    assignedTo_name: lead.assignedTo?.name ?? null,
    assignedTo_employeeCode: lead.assignedTo?.employeeCode ?? null,
    assignedTo_id: lead.assignedTo?.id ?? null,
    assignedTo_email: lead.assignedTo?.email ?? null,

    profile_budget: profile?.budget ?? null,
    profile_courseType: profile?.courseType ?? null,
    profile_collegeType: profile?.collegeType ?? null,
    profile_specialisation: profile?.specialisation ?? null,
    profile_scholarshipAwareness: profile?.scholarshipAwareness ?? null,
    profile_loanRequirement: profile?.loanRequirement ?? null,
    profile_loanAmount: profile?.loanAmount ?? null,
    profile_paymentModePreference: profile?.paymentModePreference ?? null,
    profile_stayPreference: profile?.stayPreference ?? null,
    profile_class10Percentage: profile?.class10Percentage ?? null,
    profile_class12Percentage: profile?.class12Percentage ?? null,
    profile_board: profile?.board ?? null,
    profile_mediumOfInstruction: profile?.mediumOfInstruction ?? null,
    profile_preferredCityNames: profile?.preferredCityNames ?? null,
    profile_preferredStateNames: profile?.preferredStateNames ?? null,
    profile_entranceExam: profile?.entranceExam ?? null,
    profile_keyAmenities: profile?.keyAmenities ?? null,

    today: new Date().toISOString().slice(0, 10),
    now: new Date().toISOString(),
  };
}
