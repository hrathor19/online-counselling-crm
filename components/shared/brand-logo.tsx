/**
 * The KollegeApply mark.
 *
 * Inlined rather than loaded from /new-logo.svg or the marketing site: it is
 * 288 bytes, so a request to fetch it costs more than the bytes themselves,
 * and the login page should not blank its logo if the CDN is slow or down.
 * The file is also kept at public/new-logo.svg for anything that needs a URL.
 *
 * Defaults to the brand coral. Pass `className="text-white"` with
 * `colored={false}` to have it take the surrounding text colour instead —
 * needed wherever it sits on a coral or light background.
 */
export function BrandLogo({
  className = 'h-7 w-7',
  colored = true,
}: {
  className?: string;
  colored?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 31 29"
      fill="none"
      className={className}
      role="img"
      aria-label="KollegeApply"
    >
      <path
        d="M11.6013 10.3504L3 18.8218L11.6013 27.4545H19.9339L11.1713 19.1176L19.7726 10.1756L11.6013 2H20.243L28.4545 10.1756L19.9339 18.8218"
        stroke={colored ? '#F47062' : 'currentColor'}
        strokeWidth="2.90909"
      />
    </svg>
  );
}
