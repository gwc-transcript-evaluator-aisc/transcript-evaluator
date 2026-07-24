import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRunResult } from "@/hooks/useRunResult";
import { useStudentDirectory } from "@/hooks/useStudentDirectory";
import { useStudentResults } from "@/hooks/useStudentResults";
import type { ArticulationResultDto, CatalogResolutionDto, PairResultDto, RequiredCourseResultDto, StudentDirectorySummaryDto } from "@/lib/api/orchestratorTypes";

type BadgeVariant = "success" | "warning" | "error" | "info" | "secondary";

function runIdFromLocation(): string | null {
  const queryIndex = window.location.hash.indexOf("?");
  if (queryIndex === -1) return null;
  return new URLSearchParams(window.location.hash.slice(queryIndex + 1)).get("runId");
}

function matchingVariant(outcome: RequiredCourseResultDto["matchingOutcome"]): BadgeVariant {
  return outcome === "matched" ? "success" : outcome === "unmatched" ? "secondary" : "error";
}

function pairVariant(outcome: PairResultDto["outcome"]): BadgeVariant {
  return outcome === "evaluated" ? "success" : outcome === "unresolved" ? "warning" : "error";
}

function resolutionLabel(resolution: CatalogResolutionDto): string {
  if (resolution.kind === "unresolved") return `Unresolved: ${resolution.message}`;
  return `${resolution.resolved.institution} (${resolution.resolved.academicYear}) · ${resolution.method}`;
}

function resultLabel(result: ArticulationResultDto): string {
  return `${new Date(result.createdAt).toLocaleString()} · ${result.degreeProgramId}`;
}

function StudentPicker({ students, selectedStudentKey, onSelect }: {
  students: StudentDirectorySummaryDto[];
  selectedStudentKey: string | null;
  onSelect: (studentKey: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return students;
    return students.filter((student) => student.displayName.toLowerCase().includes(normalized)
      || student.externalStudentId?.toLowerCase().includes(normalized)
      || student.studentKey.toLowerCase().includes(normalized));
  }, [query, students]);

  return <div className="space-y-3">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Search students" className="pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search students" value={query} />
    </div>
    <div className="max-h-80 space-y-1 overflow-auto" aria-label="Student directory">
      {matches.map((student) => <button key={student.studentKey} type="button" onClick={() => onSelect(student.studentKey)} className={`w-full rounded-md p-3 text-left text-sm hover:bg-slate-100 ${student.studentKey === selectedStudentKey ? "bg-slate-100 ring-1 ring-primary" : ""}`}>
        <span className="block font-semibold">{student.displayName}</span>
        <span className="block text-xs text-muted-foreground">{student.externalStudentId ?? student.studentKey} · {student.resultCount} result{student.resultCount === 1 ? "" : "s"}</span>
      </button>)}
      {query && matches.length === 0 && <p className="p-3 text-sm text-muted-foreground">No students match this search.</p>}
    </div>
  </div>;
}

function PairResult({ pair }: { pair: PairResultDto }) {
  const course = [pair.takenCourse.courseCode, pair.takenCourse.courseTitle].filter(Boolean).join(" — ") || `Transcript course ${pair.takenCourse.sourceCourseId}`;
  return <li className="rounded-md border bg-slate-50 p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{course}</span><Badge variant={pairVariant(pair.outcome)}>{pair.outcome}</Badge>{pair.decision && <Badge variant="info">{pair.decision}{pair.confidence ? ` · ${pair.confidence}` : ""}</Badge>}</div>
    <p className="mt-1 text-xs text-muted-foreground">{resolutionLabel(pair.takenResolution)}</p>
    {pair.rationale && <p className="mt-2">{pair.rationale}</p>}
    {pair.message && <p className="mt-2 text-amber-800">{pair.message}</p>}
  </li>;
}

function RequiredCourseResult({ requirement }: { requirement: RequiredCourseResultDto }) {
  const [expanded, setExpanded] = useState(true);
  const course = [requirement.requiredCourse.courseCode, requirement.requiredCourse.courseTitle].filter(Boolean).join(" — ");
  return <section className="rounded-lg border" aria-label={`Requirement ${course}`}>
    <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
      <span className="flex min-w-0 items-center gap-2"><span>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span><span><span className="block font-semibold">{course}</span><span className="block text-xs text-muted-foreground">{requirement.requiredCourse.institution} · {requirement.requiredCourse.academicYear}</span></span></span>
      <Badge variant={matchingVariant(requirement.matchingOutcome)}>{requirement.matchingOutcome}</Badge>
    </button>
    {expanded && <div className="space-y-3 border-t p-4">
      <p className="text-sm text-muted-foreground">{resolutionLabel(requirement.requiredResolution)}</p>
      {requirement.message && <p className="text-sm text-red-700">{requirement.message}</p>}
      {requirement.matchingOutcome === "matched" && requirement.pairResults.length === 0 && <p className="text-sm text-muted-foreground">No evaluation pairs were produced.</p>}
      {requirement.matchingOutcome === "unmatched" && <p className="text-sm text-muted-foreground">No semantically matching transcript course was found.</p>}
      {requirement.pairResults.length > 0 && <ul className="space-y-2">{requirement.pairResults.map((pair) => <PairResult key={pair.pairId} pair={pair} />)}</ul>}
    </div>}
  </section>;
}

function ResultView({ result }: { result: ArticulationResultDto }) {
  return <div className="space-y-4">
    <Card><CardHeader className="pb-3"><CardTitle className="text-xl">{result.student.displayName}</CardTitle><CardDescription>Program: {result.degreeProgramId} · Transcript {result.transcriptId} · Result {result.resultId}</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Created {new Date(result.createdAt).toLocaleString()}{result.student.externalStudentId ? ` · Student ID ${result.student.externalStudentId}` : ""}</p></CardContent></Card>
    {result.excludedTakenCourses.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Excluded transcript courses</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{result.excludedTakenCourses.map((excluded) => <li key={excluded.takenCourse.sourceCourseId}><span className="font-medium">{excluded.takenCourse.courseCode ?? `Course ${excluded.takenCourse.sourceCourseId}`}</span>: {excluded.message} <span className="text-muted-foreground">({excluded.reasonCode})</span></li>)}</ul></CardContent></Card>}
    <Card><CardHeader className="pb-3"><CardTitle className="text-lg">Required course results</CardTitle><CardDescription>Matching outcomes are separate from individual evaluation outcomes.</CardDescription></CardHeader><CardContent className="space-y-3">{result.requiredCourseResults.length === 0 ? <p className="text-sm text-muted-foreground">This program has no required courses.</p> : result.requiredCourseResults.map((requirement) => <RequiredCourseResult key={requirement.requiredCourseId} requirement={requirement} />)}</CardContent></Card>
  </div>;
}

export function Dashboard() {
  const [selectedStudentKey, setSelectedStudentKey] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!exactResult.result && studentResults.results.length > 0 && !selectedResultId) setSelectedResultId(studentResults.results[0].resultId);
  }, [exactResult.result, selectedResultId, studentResults.results]);

  const selectStudent = (studentKey: string) => {
    setSelectedStudentKey(studentKey);
    setSelectedResultId(null);
  };
  const selectedResult = exactResult.result ?? studentResults.results.find((result) => result.resultId === selectedResultId) ?? null;
  const activeError = exactResult.error ?? directory.error ?? studentResults.error;
  const loading = exactResult.loading || directory.loading || (selectedStudentKey !== null && studentResults.loading);

  return <main className="flex-1 overflow-auto" aria-busy={loading}>
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      <div><h2 className="text-2xl font-bold">Articulation results</h2><p className="text-sm text-muted-foreground">Browse completed evaluations by student and run.</p></div>
      {activeError && <Card className="border-red-300"><CardHeader><CardTitle className="text-red-700">Results could not be loaded</CardTitle><CardDescription>{activeError}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void directory.reload(); if (selectedStudentKey) void studentResults.reload(); }}>Try again</Button></CardContent></Card>}
      {!activeError && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading articulation results…</div>}
      {!activeError && !loading && directory.students.length === 0 && <Card><CardHeader><CardTitle>No articulation results yet</CardTitle><CardDescription>The student directory is empty. Upload a completed transcript to begin an evaluation.</CardDescription></CardHeader></Card>}
      {!activeError && directory.students.length > 0 && <div className="grid gap-6 lg:grid-cols-[300px_260px_1fr]">
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Students</CardTitle></CardHeader><CardContent><StudentPicker students={directory.students} selectedStudentKey={selectedStudentKey} onSelect={selectStudent} />{directory.cursor && <Button variant="outline" className="mt-3 w-full" disabled={directory.loadingMore} onClick={() => void directory.loadNextPage()}>{directory.loadingMore ? "Loading…" : "Load more students"}</Button>}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Result history</CardTitle><CardDescription>Newest result is selected by default.</CardDescription></CardHeader><CardContent className="space-y-2">{studentResults.loading && <p className="text-sm text-muted-foreground">Loading history…</p>}{!studentResults.loading && studentResults.results.length === 0 && <p className="text-sm text-muted-foreground">No results for this student.</p>}{studentResults.results.map((result) => <button type="button" key={result.resultId} onClick={() => setSelectedResultId(result.resultId)} className={`w-full rounded-md border p-3 text-left text-sm hover:bg-slate-50 ${selectedResult?.resultId === result.resultId ? "border-primary bg-primary/5" : ""}`}><span className="block font-medium">{result.degreeProgramId}</span><span className="block text-xs text-muted-foreground">{resultLabel(result)}</span></button>)}{studentResults.cursor && <Button variant="outline" className="w-full" disabled={studentResults.loadingMore} onClick={() => void studentResults.loadNextPage()}>{studentResults.loadingMore ? "Loading…" : "Load more results"}</Button>}</CardContent></Card>
        <div>{selectedResult ? <ResultView result={selectedResult} /> : <Card><CardHeader><CardTitle>Select a result</CardTitle><CardDescription>Choose a completed result from the history to review its requirement and pair outcomes.</CardDescription></CardHeader></Card>}</div>
      </div>}
    </div>
  </main>;
}
