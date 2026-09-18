// Resolve membership on the server; never use the configured Crew company
// as a fallback for an authenticated account with no membership.
export async function resolveCompanyId(sb, companySlug) {
  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData?.session) {
    const { data, error } = await sb.rpc("current_company_id");
    if (error) throw error;
    if (!data) throw new Error("This account is not assigned to a company.");
    return data;
  }
  if (!companySlug) throw new Error("Company is not configured (VITE_COMPANY_SLUG).");
  const { data, error } = await sb.from("companies").select("id").eq("slug", companySlug).maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("The configured company could not be resolved.");
  return data.id;
}
