"use client";
import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/components/ui/use-toast";
import axios from "axios";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import moment from "moment";
import Link from "next/link";

export default function Home() {
  const { toast } = useToast();
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(true);
  const [gitUrl, setGitUrl] = useState("");
  const [logs, setLogs] = useState<any[]>([]);
  const [deployId, setDeployId] = useState<string | undefined>();
  const [deployPreviewURL, setDeployPreviewURL] = useState<
    string | undefined
  >();
  const intervalIdRef = useRef<NodeJS.Timeout | undefined>();

  const handleDeploy = async (id: string) => {
    try {
      const response = await axios.post("http://localhost:9000/deploy", {
        projectId: id,
      });
      const deployID = response.data.data.deploymentId;
      const deployedUrl = response.data.data.deployedUrl;

      setDeployId(deployID);
      setDeployPreviewURL(deployedUrl);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Internal Server Error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGetLogs = async () => {
    try {
      if (!deployId) return;

      const response = await axios.get(
        `http://localhost:9000/logs/${deployId}`
      );

      if (response?.data?.logs) {
        setLogs(response.data.logs);

        if (response.data.logs.length === 0) {
          setLogsLoading(true);
        } else {
          setLogsLoading(false);
        }

        const processDone = response.data.logs.some(
          (log: any) => log.log === "Process Done..."
        );
        if (processDone) {
          clearInterval(intervalIdRef.current);
        }
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Internal Server Error",
      });
      setLogsLoading(false);
      clearInterval(intervalIdRef.current);
    }
  };

  const handleCreateProject = async () => {
    const gitUrlRegex = new RegExp(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/)?$/
    );

    if (!gitUrlRegex.test(gitUrl)) {
      toast({
        variant: "destructive",
        title: "Enter valid Github Repository URL",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await axios.post("http://localhost:9000/project", {
        name: "Test project",
        gitURL: gitUrl,
      });
      handleDeploy(response.data.data.project.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Internal Server Error",
      });
      setLoading(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    handleGetLogs();
  }, []);

  useEffect(() => {
    if (deployId) {
      const id: NodeJS.Timeout = setInterval(handleGetLogs, 5000);
      intervalIdRef.current = id;

      return () => {
        clearInterval(id);
      };
    }
  }, [deployId]);

  if (!isMounted) {
    return null;
  }

  return (
    <div className="h-[100vh] w-100 flex justify-center items-center">
      <Toaster />

      {deployPreviewURL ? (
        <div>
          <Card className="w-[600px] mb-10 m-auto">
            <CardHeader>
              <CardTitle className="mb-1 text-[18px]">
                <Link href={deployPreviewURL} target="_blank">
                  {deployPreviewURL}
                </Link>
              </CardTitle>
              <CardDescription> Your deployed project URL</CardDescription>
            </CardHeader>
          </Card>

          <Accordion
            type="single"
            defaultValue="item-1"
            className="w-[600px] mt-10"
            collapsible
          >
            <AccordionItem value="item-1">
              <AccordionTrigger className="text-lg text-white">
                Deployment Details
              </AccordionTrigger>
              <AccordionContent>
                <ScrollArea className="h-[400px] w-full">
                  {logsLoading ? (
                    <div className="text-center my-4 text-lg text-white">
                      loading...
                    </div>
                  ) : (
                    logs.map((log: any) => (
                      <div className="flex gap-6 mb-2">
                        <div className="text-sm text-gray-400 min-w-[100px]">
                          {moment(log.timestamp).format("hh:mm:ss a")}
                        </div>
                        <div className="text-white">{log.log}</div>
                      </div>
                    ))
                  )}
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      ) : (
        <Card className="w-[450px]">
          <CardHeader>
            <CardTitle>Create project</CardTitle>
            <CardDescription>Deploy your project in one-click.</CardDescription>
          </CardHeader>
          <CardContent>
            <form>
              <div className="grid w-full items-center gap-4">
                <div className="flex flex-col space-y-1.5">
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    placeholder="Git URL of your project"
                    value={gitUrl}
                    onChange={(e) => setGitUrl(e.target.value)}
                  />
                </div>
              </div>
            </form>
          </CardContent>
          <CardFooter className="w-100">
            <Button
              disabled={!gitUrl || loading}
              onClick={handleCreateProject}
              style={{ width: "100%" }}
            >
              Deploy
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
