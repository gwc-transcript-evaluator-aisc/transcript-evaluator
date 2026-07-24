import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LoaderCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { StudentInformationCard } from "@/components/StudentInformationCard";
import { RequirementsCard } from "@/components/RequirementsCard";
import { CourseComparisonWorkspace, type EvaluatorDecision } from "@/components/CourseComparisonWorkspace";
import { SourceMaterialCard } from "@/components/SourceMaterialCard";
import { ErrorSummaryCard } from "@/components/ErrorSummaryCard";
import { EvaluatorNotes } from "@/components/EvaluatorNotes";
import { FinalDecisionCard, type FinalDecision } from "@/components/FinalDecisionCard";
import { GenerateReportButton } from "@/components/GenerateReportButton";
import { useRunResult } from "@/hooks/useRunResult";
import { useStudentDirectory } from "@/hooks/useStudentDirectory";
import { useStudentResults } from "@/hooks/useStudentResults";
import { mapArticulationResult } from "@/lib/mapResult";
import type { ArticulationResultDto, StudentDirectorySummaryDto } from "@/lib/api/orchestratorTypes";

function runIdFromLocation(): string | null {
  const queryIndex = window.location.hash.indexOf("?");
  if (queryIndex === -1) return null;
  return new URLSearchParams(window.location.hash.slice(queryIndex + 1)).get("runId");
}

/** Real student search that mirrors the concept's StudentSearch look but selects from the live directory. */
function StudentSearch({ students, selectedStudentKey, onSelect }: {
  students: StudentDirectorySummaryDto[];
  selectedStudentKey: string | null;
  onSelect: (studentKey: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return students;
    return students.filter((student) => student.displayName.toLowerCase().includes(normalized)
      || student.externalStudentId?.toLowerCase().includes(normalized)
      || student.studentKey.toLowerCase().includes(normalized));
  }, [query, students]);
  const selected = students.find((student) => student.studentKey === selectedStudentKey);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Search students"
        className="pl-9"
        placeholder={selected ? selected.displayName : "Search students…"}
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-md" aria-label="Student directory">
          {matches.map((student) => (
            <button
              key={student.studentKey}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); onSelect(student.studentKey); setQuery(""); setOpen(false); }}
              className={`w-full p-2.5 text-left text-sm transition-colors hover:bg-accent ${student.studentKey === selectedStudentKey ? "bg-primary/10" : ""}`}
            >
              <span className="block font-semibold">{student.displayName}</span>
              <span className="block text-xs text-muted-foreground">{student.externalStudentId ?? student.studentKey} · {student.resultCount} result{student.resultCount === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const [selectedStudentKey, setSelectedStudentKey] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [currentCourseIndex, setCurrentCourseIndex] = useState(0);
  const [searchCourseQuery, setSearchCourseQuery] = useState("");
  const [evaluatorDecisions, setEvaluatorDecisions] = useState<Record<string, EvaluatorDecision>>({});
  const [finalDecision, setFinalDecision] = useState<FinalDecision>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const runId = runIdFromLocation();
  const directory = useStudentDirectory();
  const studentResults = useStudentResults(selectedStudentKey);
  const exactResult = useRunResult(runId);

  useEffect(() => {
    if (exactResult.result) {
      setSelectedStudentKey(exactResult.result.student.studentKey);
      setSelectedResultId(exactResult.result.resultId);
    }
  }, [exactResult.result]);

  useEffect(() => {
    if (!selectedStudentKey && directory.students.length > 0 && !runId) setSelectedStudentKey(directory.students[0].studentKey);
  }, [directory.students, runId, selectedStudentKey]);

  // Select the student's newest result whenever the current selection isn't one of theirs
  // (e.g. right after switching students, when the stale id belongs to the previous student).
  useEffect(() => {
    if (studentResults.results.length === 0) return;
    const present = selectedResultId !== null && studentResults.results.some((result) => result.resultId === selectedResultId);
    if (!present) setSelectedResultId(studentResults.results[0].resultId);
  }, [selectedResultId, studentResults.results]);

  // Prefer the run-linked result only while its student is the one selected; once the user
  // picks a different student, fall back to that student's results (newest if none chosen).
  const runResultMatchesSelection = exactResult.result !== null
    && (selectedStudentKey === null || exactResult.result.student.studentKey === selectedStudentKey);
  const selectedResult = (runResultMatchesSelection ? exactResult.result : null)
    ?? studentResults.results.find((result) => result.resultId === selectedResultId)
    ?? studentResults.results[0]
    ?? null;

  const resetCourseState = () => {
    setCurrentCourseIndex(0);
    setEvaluatorDecisions({});
    setFinalDecision(null);
    setIsSubmitted(false);
  };

  // Reset workspace state whenever the active result changes.
  useEffect(() => { resetCourseState(); }, [selectedResult?.resultId]);

  const mapped = useMemo(() => (selectedResult ? mapArticulationResult(selectedResult) : null), [selectedResult]);
  const activeError = exactResult.error ?? directory.error ?? studentResults.error;
  const loading = exactResult.loading || directory.loading || (selectedStudentKey !== null && studentResults.loading);

  const comparisons = mapped?.comparisons ?? [];
  const currentComparison = comparisons[currentCourseIndex] ?? comparisons[0];

  const selectStudent = (studentKey: string) => { setSelectedStudentKey(studentKey); setSelectedResultId(null); };
  const selectCourse = (index: number) => { setCurrentCourseIndex(index); setEvaluatorDecisions({}); setFinalDecision(null); setIsSubmitted(false); };
  const handleNextCourse = () => { if (currentCourseIndex < comparisons.length - 1) selectCourse(currentCourseIndex + 1); };
  const handleGenerateReport = () => {
    if (!mapped) return;
    window.alert(`Generating evaluation report for ${mapped.student.name}…\n\nEvaluator Decision: ${finalDecision ?? "Pending"}\nStatus: ${isSubmitted ? "Submitted" : "Not submitted"}`);
  };

  return (
    <main className="flex-1 overflow-auto" aria-busy={loading}>
      <div className="mx-auto max-w-[1800px] space-y-6 p-6">
        {activeError && (
          <Card className="border-error/40">
            <CardHeader><CardTitle className="text-error">Results could not be loaded</CardTitle><CardDescription>{activeError}</CardDescription></CardHeader>
            <CardContent><Button variant="outline" onClick={() => { void directory.reload(); if (selectedStudentKey) void studentResults.reload(); }}>Try again</Button></CardContent>
          </Card>
        )}

        {!activeError && loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading articulation results…</div>
        )}

        {!activeError && !loading && directory.students.length === 0 && (
          <Card><CardHeader><CardTitle>No articulation results yet</CardTitle><CardDescription>The student directory is empty. Upload a completed transcript to begin an evaluation.</CardDescription></CardHeader></Card>
        )}

        {!activeError && directory.students.length > 0 && (
          <>
            {/* Top row: student search + result history + generate report */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                <div className="w-full sm:w-80"><StudentSearch students={directory.students} selectedStudentKey={selectedStudentKey} onSelect={selectStudent} /></div>
                {studentResults.results.length > 0 && (
                  <select
                    aria-label="Result history"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-72"
                    value={selectedResult?.resultId ?? ""}
                    onChange={(event) => setSelectedResultId(event.target.value)}
                  >
                    {studentResults.results.map((result: ArticulationResultDto) => (
                      <option key={result.resultId} value={result.resultId}>{result.degreeProgramId} · {new Date(result.createdAt).toLocaleString()}</option>
                    ))}
                  </select>
                )}
              </div>
              {mapped && (
                <GenerateReportButton
                  studentName={mapped.student.name}
                  onGenerate={handleGenerateReport}
                  coursesReviewed={isSubmitted ? 1 : 0}
                  totalCourses={comparisons.length}
                  hasOverrides={Object.values(evaluatorDecisions).some((decision) => decision === "override")}
                  finalDecision={finalDecision}
                  isSubmitted={isSubmitted}
                />
              )}
            </div>

            <Separator />

            {mapped && currentComparison ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr_300px]">
                {/* LEFT: student info + required course navigation */}
                <div className="space-y-4">
                  <StudentInformationCard student={mapped.student} />
                  <RequirementsCard
                    requiredCourses={mapped.requiredCourses}
                    courseComparisons={comparisons}
                    currentCourseIndex={currentCourseIndex}
                    onSelectCourse={selectCourse}
                  />
                </div>

                {/* CENTER: course search + comparison workspace + source material */}
                <div className="space-y-4">
                  <div className="relative mx-auto max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search Course..."
                      value={searchCourseQuery}
                      onChange={(event) => setSearchCourseQuery(event.target.value)}
                      className="border-amber-200 bg-amber-50 pl-9 focus-visible:ring-amber-400"
                      aria-label="Search course"
                    />
                  </div>
                  <CourseComparisonWorkspace comparison={currentComparison} onDecisionsChange={setEvaluatorDecisions} />
                  <SourceMaterialCard materials={mapped.sourceMaterials} />
                </div>

                {/* RIGHT: error summary + notes + final decision + next */}
                <div className="space-y-4">
                  <ErrorSummaryCard comparisons={comparisons} currentComparison={currentComparison} evaluatorDecisions={evaluatorDecisions} />
                  <EvaluatorNotes courseNumber={currentComparison.transferCourse.courseNumber} />
                  <Separator />
                  <FinalDecisionCard
                    decision={finalDecision}
                    onDecisionChange={setFinalDecision}
                    onSubmit={() => setIsSubmitted(true)}
                    isSubmitted={isSubmitted}
                    courseNumber={currentComparison.transferCourse.courseNumber}
                  />
                  {currentCourseIndex < comparisons.length - 1 && (
                    <Button variant="outline" size="sm" className="w-full" onClick={handleNextCourse}>
                      OPEN NEXT COURSE
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              !loading && <Card><CardHeader><CardTitle>Select a result</CardTitle><CardDescription>Choose a student and a completed result to review its course comparisons.</CardDescription></CardHeader></Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}
