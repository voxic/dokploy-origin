import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { PenBoxIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

const formSchema = z.object({
	name: z.string().min(1, "Name is required"),
	originAppId: z.string().min(1, "App ID is required"),
	originPrivateKey: z.string().optional(),
});

interface Props {
	originId: string;
}

export const EditOriginProvider = ({ originId }: Props) => {
	const [open, setOpen] = useState(false);
	const {
		data: origin,
		isLoading,
		refetch,
	} = api.origin.one.useQuery({ originId });
	const { mutateAsync, isPending: isUpdating } =
		api.origin.update.useMutation();
	const { mutateAsync: testConnection, isPending: isTesting } =
		api.origin.testConnection.useMutation();
	const urlObj = useUrl();
	const baseUrl =
		typeof urlObj === "string"
			? urlObj
			: (urlObj as { url?: string })?.url || "";
	const redirectUri = `${baseUrl}/api/providers/origin/callback`;
	const httpsRedirect = redirectUri.startsWith("https://");
	const { mutateAsync: getInstallUrl, isPending: isInstallUrl } =
		api.origin.getInstallUrl.useMutation();

	const form = useForm({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "",
			originAppId: "",
			originPrivateKey: "",
		},
	});

	useEffect(() => {
		if (origin) {
			form.reset({
				name: origin.gitProvider?.name || "",
				originAppId: origin.originAppId || "",
				originPrivateKey: "",
			});
		}
	}, [origin, form]);

	const onSubmit = async (values: z.infer<typeof formSchema>) => {
		if (!origin?.gitProviderId) {
			return;
		}
		await mutateAsync({
			originId,
			gitProviderId: origin.gitProviderId,
			name: values.name,
			originAppId: values.originAppId,
			originPrivateKey: values.originPrivateKey || undefined,
		})
			.then(async () => {
				toast.success("Origin provider updated");
				await refetch();
				setOpen(false);
			})
			.catch((error) => {
				toast.error(
					error instanceof Error ? error.message : "Failed to update Origin",
				);
			});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon">
					<PenBoxIcon className="size-4 text-muted-foreground" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Edit Origin Provider</DialogTitle>
					<DialogDescription>
						Update the Origin App credentials. Leave the private key empty to
						keep the stored key.
					</DialogDescription>
				</DialogHeader>
				{isLoading ? (
					<div className="text-sm text-muted-foreground">Loading...</div>
				) : (
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Name</FormLabel>
										<FormControl>
											<Input {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="originAppId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Origin App ID</FormLabel>
										<FormControl>
											<Input {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="originPrivateKey"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Private key</FormLabel>
										<FormControl>
											<Textarea
												className="font-mono text-xs"
												rows={4}
												placeholder="Leave empty to keep the current key"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="flex flex-wrap gap-2">
								<Button type="submit" isLoading={isUpdating}>
									Save
								</Button>
								<Button
									type="button"
									variant="outline"
									isLoading={isTesting}
									onClick={async () => {
										await testConnection({ originId })
											.then((message) => toast.success(message))
											.catch((error) =>
												toast.error(
													error instanceof Error
														? error.message
														: "Connection failed",
												),
											);
									}}
								>
									Test connection
								</Button>
								<Button
									type="button"
									variant="secondary"
									isLoading={isInstallUrl}
									onClick={async () => {
										if (!httpsRedirect) {
											toast.error(
												"Install callback must be public HTTPS (same constraint as GitHub App).",
											);
											return;
										}
										const result = await getInstallUrl({
											originId,
											redirectUri,
										});
										window.location.href = result.url;
									}}
								>
									Install
								</Button>
							</div>
						</form>
					</Form>
				)}
			</DialogContent>
		</Dialog>
	);
};
