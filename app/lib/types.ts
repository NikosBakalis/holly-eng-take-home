/** Shape of each entry in data/job-descriptions.json */
export interface RawJobDescription {
  jurisdiction: string;
  code: string;
  title: string;
  description: string;
}

/** Shape of each entry in data/salaries.json (note: different casing from job descriptions) */
export interface RawSalary {
  Jurisdiction: string;
  "Job Code": string;
  "Approval Date"?: string;
  "Salary grade 1": string;
  "Salary grade 2": string;
  "Salary grade 3": string;
  "Salary grade 4": string;
  "Salary grade 5": string;
  "Salary grade 6": string;
  "Salary grade 7": string;
  "Salary grade 8": string;
  "Salary grade 9": string;
  "Salary grade 10": string;
  "Salary grade 11": string;
  "Salary grade 12": string;
  "Salary grade 13": string;
  "Salary grade 14": string;
}

export interface SalaryGrade {
  grade: number;
  value: string;
}

/** Joined record: job description + matched salary data */
export interface JobRecord {
  jurisdiction: string;
  code: string;
  title: string;
  description: string;
  salaryGrades: SalaryGrade[];
  approvalDate?: string;
}

export interface JurisdictionAlias {
  /** Raw jurisdiction key from data, e.g. "sanbernardino" */
  key: string;
  /** Human-readable label, e.g. "San Bernardino" */
  label: string;
  /** All tokens that should match this jurisdiction */
  tokens: string[];
}

export interface SearchIndex {
  records: JobRecord[];
  jurisdictionAliases: JurisdictionAlias[];
  /** Maps n-gram string -> set of record indices */
  ngramIndex: Map<string, Set<number>>;
  /** Maps jurisdiction key -> set of record indices */
  jurisdictionIndex: Map<string, Set<number>>;
}

export interface MatchResult {
  record: JobRecord;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}
