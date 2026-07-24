import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CourseComparison } from "@/types/course";

interface CourseDescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparison: CourseComparison;
}

export function CourseDescriptionDialog({
  open,
  onOpenChange,
  comparison,
}: CourseDescriptionDialogProps) {
  const { transferCourse, equivalentCourse } = comparison;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Course Description Comparison</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 mt-4">
          {/* Left Column: Golden West (Equivalent) */}
          <Card className="border-green-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-center text-green-800">
                {equivalentCourse.institutionName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Title:</span>
                  <span className="font-semibold text-right">{equivalentCourse.title}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Course Number:</span>
                  <span className="font-semibold">{equivalentCourse.courseNumber}</span>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Course Description:
                </p>
                <ScrollArea className="h-[250px] rounded-md border p-3 bg-muted/30">
                  <p className="text-sm leading-relaxed">
                    {equivalentCourse.description}
                  </p>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          {/* Separator */}
          <div className="hidden md:flex items-center">
            <Separator orientation="vertical" className="h-full" />
          </div>

          {/* Right Column: Transfer Institution */}
          <Card className="border-blue-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-center text-blue-800">
                {transferCourse.institutionName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Title:</span>
                  <span className="font-semibold text-right">{transferCourse.title}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Course Number:</span>
                  <span className="font-semibold">{transferCourse.courseNumber}</span>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Course Description:
                </p>
                <ScrollArea className="h-[250px] rounded-md border p-3 bg-muted/30">
                  <p className="text-sm leading-relaxed">
                    {transferCourse.description}
                  </p>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
