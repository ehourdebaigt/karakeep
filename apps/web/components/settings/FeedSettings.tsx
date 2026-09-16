"use client";

import React from "react";
import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import FilePickerButton from "@/components/ui/file-picker-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import FormattedDate from "@/components/ui/formatted-date";
import { FullPageSpinner } from "@/components/ui/full-page-spinner";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CheckCircle,
  CircleDashed,
  CirclePlus,
  Download,
  Edit,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useTRPC } from "@karakeep/shared-react/trpc";
import {
  ZFeed,
  zNewFeedSchema,
  zUpdateFeedSchema,
} from "@karakeep/shared/types/feeds";

import ActionConfirmingDialog from "../ui/action-confirming-dialog";
import { Button, buttonVariants } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { SettingsPage, SettingsSection } from "./SettingsPage";

function guessNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function FeedsEditorDialog() {
  const api = useTRPC();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<
    { url: string; title?: string }[] | null
  >(null);
  const queryClient = useQueryClient();

  const form = useForm({
    resolver: zodResolver(zNewFeedSchema),
    defaultValues: {
      name: "",
      url: "",
      enabled: true,
      importTags: false,
      importFullContent: false,
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset();
      setCandidates(null);
    }
  }, [open]);

  const { mutateAsync: createFeed, isPending: isCreating } = useMutation(
    api.feeds.create.mutationOptions({
      onSuccess: () => {
        toast({
          description: "Feed has been created!",
        });
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
        setOpen(false);
      },
    }),
  );

  const { mutateAsync: discoverFeeds, isPending: isDiscovering } = useMutation(
    api.feeds.discover.mutationOptions({
      onError: (error) => {
        toast({
          description: `Could not discover a feed at that URL: ${error.message}`,
          variant: "destructive",
        });
      },
    }),
  );

  const applyCandidate = (candidate: { url: string; title?: string }) => {
    form.setValue("url", candidate.url);
    if (!form.getValues("name")) {
      form.setValue("name", candidate.title ?? guessNameFromUrl(candidate.url));
    }
    setCandidates(null);
  };

  const handleDiscover = async () => {
    const url = form.getValues("url");
    if (!url) {
      return;
    }
    setCandidates(null);
    const { candidates: found } = await discoverFeeds({ url });
    if (found.length === 0) {
      toast({
        description:
          "No feed links found on that page. Using the URL you entered as the feed.",
      });
      if (!form.getValues("name")) {
        form.setValue("name", guessNameFromUrl(url));
      }
    } else if (found.length === 1) {
      applyCandidate(found[0]);
      toast({ description: "Feed found!" });
    } else {
      setCandidates(found);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CirclePlus className="mr-2 size-4" />
          {t("settings.feeds.add_a_subscription")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe to a new Feed</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            className="flex flex-col gap-3"
            onSubmit={form.handleSubmit(async (value) => {
              await createFeed(value);
              form.resetField("name");
              form.resetField("url");
            })}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => {
                return (
                  <FormItem className="flex-1">
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Feed Name" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => {
                return (
                  <FormItem className="flex-1">
                    <FormLabel>URL</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          placeholder="Feed or website URL"
                          type="text"
                          {...field}
                        />
                      </FormControl>
                      <ActionButton
                        type="button"
                        variant="secondary"
                        loading={isDiscovering}
                        onClick={handleDiscover}
                        className="shrink-0 items-center"
                      >
                        <Search className="mr-2 size-4" />
                        Discover
                      </ActionButton>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Paste a feed URL, a website&apos;s homepage, or an Apple
                      Podcasts link to auto-detect its feed.
                    </div>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            {candidates && candidates.length > 1 && (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="text-sm font-medium">
                  Multiple feeds were found. Pick one:
                </div>
                {candidates.map((candidate) => (
                  <Button
                    key={candidate.url}
                    type="button"
                    variant="outline"
                    className="justify-start overflow-hidden text-ellipsis whitespace-nowrap"
                    onClick={() => applyCandidate(candidate)}
                  >
                    {candidate.title ?? candidate.url}
                  </Button>
                ))}
              </div>
            )}
            <FormField
              control={form.control}
              name="importTags"
              render={({ field }) => {
                return (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Import Tags</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Automatically import categories from RSS feed as tags
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="importFullContent"
              render={({ field }) => {
                return (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Import Full Content</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Store the full article content provided by the feed,
                        instead of relying solely on crawling the link
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                );
              }}
            />
          </form>
        </Form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
          <ActionButton
            onClick={form.handleSubmit(async (value) => {
              await createFeed(value);
            })}
            loading={isCreating}
            variant="default"
            className="items-center"
          >
            <Plus className="mr-2 size-4" />
            Add
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditFeedDialog({ feed }: { feed: ZFeed }) {
  const api = useTRPC();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      form.reset({
        feedId: feed.id,
        name: feed.name,
        url: feed.url,
        importTags: feed.importTags,
        importFullContent: feed.importFullContent,
      });
    }
  }, [open]);
  const { mutateAsync: updateFeed, isPending: isUpdating } = useMutation(
    api.feeds.update.mutationOptions({
      onSuccess: () => {
        toast({
          description: "Feed has been updated!",
        });
        setOpen(false);
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
      },
    }),
  );
  const form = useForm<z.infer<typeof zUpdateFeedSchema>>({
    resolver: zodResolver(zUpdateFeedSchema),
    defaultValues: {
      feedId: feed.id,
      name: feed.name,
      url: feed.url,
      importTags: feed.importTags,
      importFullContent: feed.importFullContent,
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost">
              <Edit className="size-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("actions.edit")}</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Feed</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-3"
            onSubmit={form.handleSubmit(async (value) => {
              await updateFeed(value);
            })}
          >
            <FormField
              control={form.control}
              name="feedId"
              render={({ field }) => {
                return (
                  <FormItem className="hidden">
                    <FormControl>
                      <Input type="hidden" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => {
                return (
                  <FormItem className="flex-1">
                    <FormLabel>{t("common.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder="Feed name" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => {
                return (
                  <FormItem className="flex-1">
                    <FormLabel>{t("common.url")}</FormLabel>
                    <FormControl>
                      <Input placeholder="Feed url" type="text" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="importTags"
              render={({ field }) => {
                return (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Import Tags</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Automatically import categories from RSS feed as tags
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                );
              }}
            />
            <FormField
              control={form.control}
              name="importFullContent"
              render={({ field }) => {
                return (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Import Full Content</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Store the full article content provided by the feed,
                        instead of relying solely on crawling the link
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value ?? false}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                );
              }}
            />
          </form>
        </Form>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t("actions.close")}
            </Button>
          </DialogClose>
          <ActionButton
            loading={isUpdating}
            onClick={form.handleSubmit(async (value) => {
              await updateFeed(value);
            })}
            type="submit"
            className="items-center"
          >
            <Save className="mr-2 size-4" />
            {t("actions.save")}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FeedRow({ feed }: { feed: ZFeed }) {
  const api = useTRPC();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutate: deleteFeed, isPending: isDeleting } = useMutation(
    api.feeds.delete.mutationOptions({
      onSuccess: () => {
        toast({
          description: "Feed has been deleted!",
        });
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
      },
    }),
  );

  const { mutate: fetchNow, isPending: isFetching } = useMutation(
    api.feeds.fetchNow.mutationOptions({
      onSuccess: () => {
        toast({
          description: "Feed fetch has been enqueued!",
        });
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
      },
    }),
  );

  const { mutate: updateFeedEnabled } = useMutation(
    api.feeds.update.mutationOptions({
      onSuccess: () => {
        toast({
          description: feed.enabled
            ? t("settings.feeds.feed_disabled")
            : t("settings.feeds.feed_enabled"),
        });
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
      },
      onError: (error) => {
        toast({
          description: `Error: ${error.message}`,
          variant: "destructive",
        });
      },
    }),
  );

  const handleToggle = (checked: boolean) => {
    updateFeedEnabled({ feedId: feed.id, enabled: checked });
  };

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/dashboard/feeds/${feed.id}`}
          className={cn(buttonVariants({ variant: "link" }))}
        >
          {feed.name}
        </Link>
      </TableCell>
      <TableCell
        className="max-w-64 overflow-clip text-ellipsis"
        title={feed.url}
      >
        {feed.url}
      </TableCell>
      <TableCell>
        <FormattedDate date={feed.lastFetchedAt} />
      </TableCell>
      <TableCell>
        {feed.lastFetchedStatus === "success" ? (
          <span title="Successful">
            <CheckCircle />
          </span>
        ) : feed.lastFetchedStatus === "failure" ? (
          <span title="Failed">
            <XCircle />
          </span>
        ) : (
          <span title="Pending">
            <CircleDashed name="Pending" />
          </span>
        )}
      </TableCell>
      <TableCell className="flex items-center gap-2">
        <Switch checked={feed.enabled} onCheckedChange={handleToggle} />
        <EditFeedDialog feed={feed} />
        <Tooltip>
          <TooltipTrigger asChild>
            <ActionButton
              loading={isFetching}
              variant="ghost"
              className="items-center"
              onClick={() => fetchNow({ feedId: feed.id })}
            >
              <ArrowDownToLine className="size-4" />
            </ActionButton>
          </TooltipTrigger>
          <TooltipContent>{t("actions.fetch_now")}</TooltipContent>
        </Tooltip>
        <ActionConfirmingDialog
          title={`Delete Feed "${feed.name}"?`}
          description={`Are you sure you want to delete the feed "${feed.name}"?`}
          actionButton={() => (
            <ActionButton
              loading={isDeleting}
              variant="destructive"
              onClick={() => deleteFeed({ feedId: feed.id })}
              className="items-center"
              type="button"
            >
              <Trash2 className="mr-2 size-4" />
              {t("actions.delete")}
            </ActionButton>
          )}
        >
          <Button variant="ghostDestructive" disabled={isDeleting}>
            <Trash2 className="size-4" />
          </Button>
        </ActionConfirmingDialog>
      </TableCell>
    </TableRow>
  );
}

function OpmlImportExportButtons() {
  const api = useTRPC();
  const queryClient = useQueryClient();

  const { mutateAsync: importOpml, isPending: isImporting } = useMutation(
    api.feeds.importOpml.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries(api.feeds.list.pathFilter());
        const parts = [`${result.created} feed(s) imported`];
        if (result.skippedDuplicate > 0) {
          parts.push(`${result.skippedDuplicate} already subscribed`);
        }
        if (result.skippedQuota > 0) {
          parts.push(`${result.skippedQuota} skipped (quota reached)`);
        }
        if (result.errors.length > 0) {
          parts.push(`${result.errors.length} failed`);
        }
        toast({ description: parts.join(", ") });
      },
      onError: (error) => {
        toast({
          description: `Failed to import OPML file: ${error.message}`,
          variant: "destructive",
        });
      },
    }),
  );

  const { refetch: fetchOpml, isFetching: isExporting } = useQuery({
    ...api.feeds.exportOpml.queryOptions(),
    enabled: false,
  });

  const onExport = async () => {
    const { data, error } = await fetchOpml();
    if (error) {
      toast({
        description: `Failed to export OPML file: ${error.message}`,
        variant: "destructive",
      });
      return;
    }
    if (!data) {
      return;
    }
    const blob = new Blob([data.opml], { type: "text/x-opml" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "karakeep-feeds.opml";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex gap-2">
      <FilePickerButton
        variant="secondary"
        accept=".opml,.xml"
        loading={isImporting}
        onFileSelect={async (file) => {
          const opml = await file.text();
          await importOpml({ opml });
        }}
      >
        <Upload className="mr-2 size-4" />
        Import OPML
      </FilePickerButton>
      <ActionButton
        variant="secondary"
        loading={isExporting}
        onClick={onExport}
        className="items-center"
      >
        <Download className="mr-2 size-4" />
        Export OPML
      </ActionButton>
    </div>
  );
}

export default function FeedSettings() {
  const api = useTRPC();
  const { t } = useTranslation();
  const { data: feeds, isLoading } = useQuery(api.feeds.list.queryOptions());
  return (
    <SettingsPage
      title={t("settings.feeds.rss_subscriptions")}
      action={
        <div className="flex gap-2">
          <OpmlImportExportButtons />
          <FeedsEditorDialog />
        </div>
      }
    >
      <SettingsSection>
        {isLoading && <FullPageSpinner />}
        {feeds && feeds.feeds.length == 0 && (
          <p className="rounded-md bg-muted p-3 text-center text-sm text-muted-foreground">
            You don&apos;t have any RSS subscriptions yet.
          </p>
        )}
        {feeds && feeds.feeds.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.url")}</TableHead>
                <TableHead>Last Fetch</TableHead>
                <TableHead>Last Status</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feeds.feeds.map((feed) => (
                <FeedRow key={feed.id} feed={feed} />
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
