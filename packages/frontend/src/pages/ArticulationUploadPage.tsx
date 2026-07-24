import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateOrchestrationRun } from "@/hooks/useCreateOrchestrationRun";
import { useDegreePrograms } from "@/hooks/useDegreePrograms";
import { useOrchestrationRunPolling } from "@/hooks/useOrchestrationRunPolling";
import { isPdfFile, useTranscriptUpload } from "@/hooks/useTranscriptUpload";
import { useTranscriptStatusPolling } from "@/hooks/useTranscriptStatusPolling";

interface ArticulationUploadPageProps {
  onCancel: () => void;
  onCompleted: (runId: string, resultKey: string, resultSortKey: string) => void;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ArticulationUploadPage({ onCancel, onCompleted }: ArticulationUploadPageProps) {
  const { programs, loading: programsLoading, error: programsError, reload } = useDegreePrograms();
  const { upload, uploading, error: uploadError, submit: uploadTranscript, reset: resetUpload } = useTranscriptUpload();
  const { status: transcriptStatus, polling: transcriptPolling, error: transcriptError } = useTranscriptStatusPolling(upload?.transcript_id ?? null);
  const { createRun, loading: creatingRun, error: createError, reset: resetRun } = useCreateOrchestrationRun();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [degreeProgramId, setDegreeProgramId] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [programError, setProgramError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [completedRun, setCompletedRun] = useState<{ runId: string; resultKey: string; resultSortKey: string } | null>(null);
  const requestId = useRef<string | null>(null);
  const startedTranscriptId = useRef<number | null>(null);
  const completedRunId = useRef<string | null>(null);
  const { run, polling: runPolling, timedOut, error: runError } = useOrchestrationRunPolling(activeRunId);

  const clearWorkflow = () => {
    resetUpload();
    resetRun();
    setSelectedFile(null);
    setDegreeProgramId("");
    setFileError(null);
    setProgramError(null);
    setActiveRunId(null);
    setCompletedRun(null);
    requestId.current = null;
    startedTranscriptId.current = null;
    completedRunId.current = null;
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setFileError(file && !isPdfFile(file) ? "Select a PDF transcript." : null);
  };

  const beginUpload = async (event: FormEvent) => {
    event.preventDefault();
    const nextFileError = !selectedFile ? "Select a PDF transcript." : !isPdfFile(selectedFile) ? "Select a PDF transcript." : null;
    const nextProgramError = !degreeProgramId ? "Select a degree program." : null;
    setFileError(nextFileError);
    setProgramError(nextProgramError);
    if (nextFileError || nextProgramError || !selectedFile) return;

    requestId.current = createRequestId();
    startedTranscriptId.current = null;
    completedRunId.current = null;
    setActiveRunId(null);
    try {
      await uploadTranscript(selectedFile);
    } catch {
      // The typed hook provides the sanitized error for rendering.
    }
  };

  const requestRun = async () => {
    if (!upload || !degreeProgramId) return;
    const stableRequestId = requestId.current ?? createRequestId();
    requestId.current = stableRequestId;
    try {
      const response = await createRun({ requestId: stableRequestId, transcriptId: upload.transcript_id, degreeProgramId });
      setActiveRunId(response.runId);
    } catch {
      // The typed hook provides the sanitized error for rendering and retry.
    }
  };

  useEffect(() => {
    if (transcriptStatus?.status !== "completed" || !upload || startedTranscriptId.current === upload.transcript_id) return;
    startedTranscriptId.current = upload.transcript_id;
    void requestRun();
  }, [transcriptStatus?.status, upload?.transcript_id, degreeProgramId]);

  useEffect(() => {
    if (run?.status !== "completed" || !run.resultLocator || completedRunId.current === run.runId) return;
    completedRunId.current = run.runId;
    setCompletedRun({
      runId: run.runId,
      resultKey: run.resultLocator.resultKey,
      resultSortKey: run.resultLocator.resultSortKey,
    });
  }, [run]);

  const processing = uploading || transcriptPolling || creatingRun || runPolling;
  const failure = uploadError ?? transcriptError ?? createError ?? runError ?? run?.failureMessage ?? (timedOut ? "The articulation run timed out after ten minutes." : null);
  const transcriptFailed = transcriptStatus?.status === "failed";

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <section className="mx-auto max-w-2xl rounded-xl border bg-white p-6 shadow-sm sm:p-8" aria-labelledby="upload-page-title">
        <Button variant="ghost" className="mb-6" onClick={onCancel}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
        </Button>
        <h1 id="upload-page-title" className="text-2xl font-bold text-slate-900">Upload transcript for articulation</h1>
        <p className="mt-2 text-sm text-muted-foreground">Upload a PDF transcript, choose the target degree program, and follow the evaluation through completion.</p>

        <form className="mt-8 space-y-6" onSubmit={beginUpload} noValidate>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="transcript-file">Transcript PDF</label>
            <input id="transcript-file" type="file" accept="application/pdf,.pdf" onChange={onFileChange} aria-describedby={fileError ? "transcript-file-error" : undefined} className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            {selectedFile && !fileError && <p className="text-sm text-muted-foreground"><FileText className="mr-1 inline h-4 w-4" />{selectedFile.name}</p>}
            {fileError && <p id="transcript-file-error" role="alert" className="text-sm text-red-600">{fileError}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="degree-program">Degree program</label>
            <select id="degree-program" value={degreeProgramId} disabled={programsLoading || Boolean(upload)} onChange={(event) => { setDegreeProgramId(event.target.value); setProgramError(null); }} aria-describedby={programError ? "degree-program-error" : undefined} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">{programsLoading ? "Loading programs…" : "Select a degree program"}</option>
              {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
            </select>
            {programError && <p id="degree-program-error" role="alert" className="text-sm text-red-600">{programError}</p>}
            {programsError && <div role="alert" className="text-sm text-red-600">{programsError} <Button type="button" variant="link" className="h-auto p-0" onClick={reload}>Try again</Button></div>}
          </div>

          <Button type="submit" disabled={processing || Boolean(upload) || programsLoading} className="w-full">
            {uploading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Upload and start evaluation
          </Button>
        </form>

        <div className="mt-6 rounded-md bg-slate-50 p-4" aria-live="polite">
          {!upload && <p className="text-sm text-muted-foreground">Choose a PDF and program to begin.</p>}
          {upload && !failure && <p className="text-sm">Transcript {upload.transcript_id}: {run?.status ?? transcriptStatus?.status ?? upload.status}{processing ? "…" : ""}</p>}
          {transcriptFailed && <p role="alert" className="text-sm text-red-600">{transcriptStatus.error_message || "Transcript processing failed."}</p>}
          {failure && <div role="alert" className="space-y-3 text-sm text-red-600"><p>{failure}</p>{(createError || runError || run?.status === "failed" || timedOut) && <Button type="button" variant="outline" onClick={requestRun}><RotateCcw className="mr-2 h-4 w-4" />Retry evaluation</Button>}</div>}
          {completedRun && <div className="space-y-3"><p className="text-sm text-emerald-700">Articulation evaluation completed.</p><Button type="button" onClick={() => onCompleted(completedRun.runId, completedRun.resultKey, completedRun.resultSortKey)}>View articulation result</Button></div>}
        </div>

        {(upload || activeRunId) && <div className="mt-6 flex justify-end"><Button type="button" variant="outline" onClick={clearWorkflow} disabled={processing}>Cancel workflow</Button></div>}
      </section>
    </main>
  );
}
