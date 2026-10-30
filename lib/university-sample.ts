/**
 * The template handed out by "Download sample file".
 *
 * It lives beside the parser, and a test parses it, so the example cannot
 * drift away from what the importer actually accepts — a template that no
 * longer imports is worse than no template, because it is believed.
 *
 * Every section is optional except the university's name; they are all here
 * so the file doubles as documentation of what a profile can carry. The
 * values are deliberately obvious placeholders so nobody uploads the sample
 * by mistake and wonders where "Example Online University" came from.
 */

type Row = (string | number)[];

const SECTIONS: { heading: string; rows: Row[] }[] = [
  {
    heading: '1. University Information',
    rows: [
      ['Field', 'Extracted Information'],
      ['University Name', 'Example Online University'],
      ['University Type', 'Private University'],
      ['Establishment Year', '2005'],
      ['Campus Address', 'Example Campus, Sector 1, Pune, Maharashtra 411001, India'],
      ['Email', 'admissions@example-online.edu.in'],
      ['Contact Number', '91-1800-000-0000'],
      // A hyperlink's target is lost when a sheet is exported to CSV, so the
      // template shows the full address written out as text.
      ['Official Website', 'https://example-online.edu.in'],
    ],
  },
  {
    heading: '2. Accreditations and Recognitions',
    rows: [
      ['Accreditation Body', 'Status'],
      ['UGC-DEB', 'Entitled to offer online degree programmes'],
      ['NAAC', "Accredited with 'A+' Grade"],
      ['AICTE', 'Approved'],
    ],
  },
  {
    heading: '3. Programmes Summary',
    rows: [
      ['Programme', 'Full Name', 'Level', 'Duration (Months)', 'Specializations'],
      ['MBA', 'Master of Business Administration', 'Postgraduate', 24, 6],
      ['BBA', 'Bachelor of Business Administration', 'Undergraduate', 36, 3],
      ['BCA', 'Bachelor of Computer Applications', 'Undergraduate', 36, 2],
    ],
  },
  {
    heading: '4. Program Specialization',
    rows: [
      ['Programme', 'Specialization', 'Type'],
      ['MBA', 'Finance', 'Specialization'],
      ['MBA', 'Marketing', 'Specialization'],
      ['BBA', 'Business Analytics', 'Specialization'],
    ],
  },
  {
    heading: '5. Fee Structure',
    rows: [
      ['Programme', 'Duration', 'Total Programme Fee', 'Annual Fee', 'Per Semester Fee', 'No-Cost EMI', 'Eligibility', 'Official Programme URL'],
      ['MBA', '2 Years', '₹1,80,000', '₹90,000', '₹45,000', '₹7,500/month', "Bachelor's degree with 50% marks", 'https://example-online.edu.in/mba'],
      ['BBA', '3 Years', '₹1,20,000', '₹40,000', '₹20,000', '₹5,000/month', '10+2 with 50% marks', 'https://example-online.edu.in/bba'],
      ['BCA', '3 Years', '₹1,35,000', '₹45,000', '₹22,500', '₹5,625/month', '10+2 with Mathematics', 'https://example-online.edu.in/bca'],
    ],
  },
  {
    heading: '6. Fee Structure For International Students',
    rows: [
      ['Level', 'Programme', 'Duration', 'Total Fee', 'Annual Fee', 'Per Semester Fee'],
      ['PG', 'MBA', '2 Years', '$3,000', '$1,500', '$750'],
      ['UG', 'BBA', '3 Years', '$2,400', '$800', '$400'],
    ],
  },
  {
    heading: '7. Frequently Asked Questions',
    rows: [
      ['Question', 'Answer'],
      ['Is the online degree recognised?', 'Yes. The programmes are UGC-DEB entitled and equivalent to on-campus degrees.'],
      ['What is the admission process?', 'Register on the portal, upload documents, pay the fee and complete verification.'],
      ['Are examinations online?', 'Yes, examinations are proctored and taken online.'],
    ],
  },
  {
    heading: '8. Company Partners',
    rows: [
      ['Infosys', 'TCS', 'Wipro', 'Accenture', 'Deloitte'],
      ['HDFC Bank', 'ICICI Bank', 'Amazon', 'Flipkart', 'KPMG'],
    ],
  },
  {
    heading: '9. Top Faculties',
    rows: [
      ['Name', 'Designation', 'Educational Qualification', 'Experience', 'Description'],
      ['Dr. A. Example', 'Professor & Dean', 'PhD in Management', '20+ years', 'Teaches strategy and organisational behaviour.'],
      ['Dr. B. Example', 'Associate Professor', 'PhD in Computer Science', '12+ years', 'Research interests in machine learning.'],
    ],
  },
  {
    heading: '10. Location and Transportation',
    rows: [
      ['Transport Type', 'Nearest Station / Stop', 'Approx. Distance'],
      ['Metro', 'Example Metro Station', '2 km'],
      ['Railway', 'Pune Junction', '6 km'],
      ['Airport', 'Pune International Airport', '12 km'],
    ],
  },
  {
    heading: '11. Scholarships and Discounts',
    rows: [
      ['Scholarship Credit', 'Eligibility Criteria'],
      ['20%', 'Defence personnel and their dependants'],
      ['15%', 'Alumni of the university'],
      ['10%', 'Upfront payment of the full programme fee'],
    ],
  },
];

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The sample file, as CSV text. */
export function buildSampleUniversityCsv(): string {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    lines.push(escapeCell(section.heading));
    for (const row of section.rows) lines.push(row.map(escapeCell).join(','));
    lines.push('');   // a blank line between sections, as the sheets have
  }
  return lines.join('\n');
}
