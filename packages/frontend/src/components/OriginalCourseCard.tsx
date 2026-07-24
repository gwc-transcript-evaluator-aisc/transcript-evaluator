import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Course } from "@/types/course";

interface OriginalCourseCardProps {
  course: Course;
}

export function OriginalCourseCard({ course }: OriginalCourseCardProps) {
  return (
    <Card className="h-full border-2 border-green-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-center">
          {course.institutionName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* COURSE INFORMATION */}
        <div className="space-y-2">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
            Course Information
          </Badge>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs">Course Number:</span>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <span className="font-semibold text-xs cursor-help border-b border-dashed">
                    {course.courseNumber}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent className="w-60">
                  <p className="text-xs">{course.courseNumber} from {course.institutionName}</p>
                </HoverCardContent>
              </HoverCard>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs">Title:</span>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <span className="font-semibold text-xs cursor-help border-b border-dashed text-right max-w-[150px] truncate">
                    {course.title}
                  </span>
                </HoverCardTrigger>
                <HoverCardContent className="w-72">
                  <h4 className="font-semibold text-sm">{course.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{course.description}</p>
                </HoverCardContent>
              </HoverCard>
            </div>
          </div>
        </div>

        <Separator />

        {/* EVALUATION CRITERIA */}
        <div className="space-y-2">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-primary/40 text-primary">
            Evaluation Criteria
          </Badge>
          <div className="space-y-2 text-sm">
            {/* Course Description */}
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs font-medium">Course Description:</span>
              <ScrollArea className="h-16 rounded-md border p-2 bg-muted/30">
                <p className="text-[11px] leading-relaxed">{course.description}</p>
              </ScrollArea>
            </div>

            {/* Credits */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs font-medium">Credits:</span>
              <span className="font-semibold text-xs">{course.credits}</span>
            </div>

            {/* Grade */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs font-medium">Grade:</span>
              <span className="font-semibold text-xs">{course.grade || "—"}</span>
            </div>

            {/* Academic Calendar / Term / Academic Year */}
            <div className="space-y-0.5">
              <span className="text-muted-foreground text-xs font-medium block">Semester/Trimester:</span>
              <div className="pl-2 space-y-0.5">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">Academic Calendar:</span>
                  <span className="font-semibold text-xs">{course.academicTerm.system}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">Term:</span>
                  <span className="font-semibold text-xs">{course.academicTerm.term}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-[11px]">Academic Year:</span>
                  <span className="font-semibold text-xs">{course.academicTerm.academicYear}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
