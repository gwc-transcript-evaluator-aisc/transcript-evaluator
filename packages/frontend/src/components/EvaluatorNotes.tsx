import { useState } from "react";
import { PenLine, Share2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EvaluatorNotesProps {
  courseNumber: string;
}

export function EvaluatorNotes({ courseNumber }: EvaluatorNotesProps) {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            Evaluator Explanation
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Share with counselor">
                <Share2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Share with counselor</TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Add your evaluation notes for <strong>{courseNumber}</strong>. These notes
          will be included in the final report and shared with the counselor.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Enter your evaluation reasoning, observations, or justification for any overrides..."
          className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          aria-label="Evaluator notes"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            Visible to: Evaluator, Counselor, Report
          </p>
          <Button size="sm" variant="outline" onClick={handleSave}>
            {saved ? "Saved!" : "Save Notes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
