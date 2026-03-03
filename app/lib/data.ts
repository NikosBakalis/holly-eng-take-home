import { promises as fs } from "fs";
import path from "path";
import type {
  RawJobDescription,
  RawSalary,
  JobRecord,
  SalaryGrade,
} from "@/lib/types";

const globalCache = globalThis as unknown as {
  __jobRecords?: JobRecord[];
};

export async function loadRecords(): Promise<JobRecord[]> {
  if (globalCache.__jobRecords) return globalCache.__jobRecords;

  const dataDir = path.join(process.cwd(), "data");

  const [jobsRaw, salariesRaw] = await Promise.all([
    fs.readFile(path.join(dataDir, "job-descriptions.json"), "utf-8"),
    fs.readFile(path.join(dataDir, "salaries.json"), "utf-8"),
  ]);

  const jobs: RawJobDescription[] = JSON.parse(jobsRaw);
  const salaries: RawSalary[] = JSON.parse(salariesRaw);

  // Build salary lookup keyed on "jurisdiction|code"
  const salaryMap = new Map<string, RawSalary>();
  for (const s of salaries) {
    const key = `${s.Jurisdiction.toLowerCase()}|${s["Job Code"]}`;
    salaryMap.set(key, s);
  }

  // Join job descriptions with their salary data
  const records: JobRecord[] = jobs.map((job) => {
    const salaryKey = `${job.jurisdiction.toLowerCase()}|${job.code}`;
    const salary = salaryMap.get(salaryKey);

    const salaryGrades: SalaryGrade[] = [];
    if (salary) {
      for (let i = 1; i <= 14; i++) {
        const fieldName = `Salary grade ${i}` as keyof RawSalary;
        const raw = salary[fieldName] as string;
        const trimmed = raw?.trim();
        if (trimmed) {
          salaryGrades.push({ grade: i, value: trimmed });
        }
      }
    }

    return {
      jurisdiction: job.jurisdiction,
      code: job.code,
      title: job.title,
      description: job.description,
      salaryGrades,
      approvalDate: salary?.["Approval Date"]?.trim() || undefined,
    };
  });

  globalCache.__jobRecords = records;
  return records;
}
