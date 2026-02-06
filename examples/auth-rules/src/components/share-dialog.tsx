"use client";

import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { VscTrash } from "react-icons/vsc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { UserSearch } from "./user-search";
import { useResourceShares, useCreateShare, useRemoveShare, useUpdateSharePermission } from "@/lib/queries";
import type { SharePermission, Folder, File } from "@/lib/types";

const shareFormSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
  }).nullable(),
  permission: z.enum(["view", "comment", "edit"]),
});

type ShareFormValues = z.infer<typeof shareFormSchema>;

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: Folder | File | null;
  resourceType: "folder" | "file";
};

export function ShareDialog({
  open,
  onOpenChange,
  resource,
  resourceType,
}: ShareDialogProps) {
  const form = useForm<ShareFormValues>({
    resolver: zodResolver(shareFormSchema),
    defaultValues: {
      user: null,
      permission: "view",
    },
  });

  const resourceId = resource?.id ?? "";
  const { data: shares, isPending: sharesLoading, error: sharesError } = useResourceShares(
    resourceType,
    resourceId
  );
  const createShare = useCreateShare();
  const removeShare = useRemoveShare();
  const updatePermission = useUpdateSharePermission();

  const existingUserIds = useMemo(
    () => (shares ?? [])
      .map((s) => s.shared_with_user_id)
      .filter((id): id is string => id !== null),
    [shares]
  );

  async function onSubmit(data: ShareFormValues) {
    if (!data.user || !resource) return;

    try {
      await createShare.mutateAsync({
        resourceType,
        resourceId: resource.id,
        sharedWithUserId: data.user.id,
        permission: data.permission as SharePermission,
      });
      form.reset();
    } catch (err) {
      console.error("Failed to create share:", JSON.stringify(err, null, 2), err);
    }
  }

  async function handleRemoveShare(shareId: string) {
    try {
      await removeShare.mutateAsync(shareId);
    } catch (err) {
      console.error("Failed to remove share:", err);
    }
  }

  const selectedUser = form.watch("user");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share "{resource?.name}"</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Controller
            name="user"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="share-user-search">Add people</FieldLabel>
                <UserSearch
                  onSelect={(user) => field.onChange(user)}
                  excludeUserIds={existingUserIds}
                  placeholder="Search by email..."
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          {selectedUser && (
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <span className="flex-1 text-sm truncate">
                {selectedUser.email}
              </span>
              <Controller
                name="permission"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id="share-permission"
                      aria-invalid={fieldState.invalid}
                      className="w-28"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="comment">Comment</SelectItem>
                      <SelectItem value="edit">Edit</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => form.setValue("user", null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createShare.isPending}
              >
                Share
              </Button>
            </div>
          )}
        </form>

        <div className="space-y-2">
          <span className="text-sm font-medium">People with access</span>
          <div className="border rounded-md divide-y">
            {sharesError ? (
              <div className="p-3 text-sm text-destructive">
                Failed to load shares (table may not exist)
              </div>
            ) : sharesLoading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading...</div>
            ) : !shares || shares.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                Not shared with anyone yet
              </div>
            ) : (
              shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center gap-2 p-2"
                >
                  <span className="flex-1 text-sm truncate">
                    {share.shared_with_email ?? "Unknown user"}
                  </span>
                  <Select
                    value={share.permission}
                    onValueChange={(value) =>
                      updatePermission.mutate({
                        shareId: share.id,
                        permission: value as SharePermission,
                      })
                    }
                    disabled={updatePermission.isPending}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View</SelectItem>
                      <SelectItem value="comment">Comment</SelectItem>
                      <SelectItem value="edit">Edit</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveShare(share.id)}
                    disabled={removeShare.isPending}
                  >
                    <VscTrash className="text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
