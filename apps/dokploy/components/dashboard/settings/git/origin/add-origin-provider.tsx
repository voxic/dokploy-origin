import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { OriginIcon } from "@/components/icons/data-tools-icons";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

const Schema = z.object({
	name: z.string().min(1, { message: "Name is required" }),
	originAppId: z.string().min(1, { message: "App ID is required" }),
	originPrivateKey: z.string().min(1, { message: "Private key is required" }),
	originPublicKey: z.string().optional(),
});

type Schema = z.infer<typeof Schema>;

export const AddOriginProvider = () => {
	const [isOpen, setIsOpen] = useState(false);
	const urlObj = useUrl();
	const baseUrl =
		typeof urlObj === "string"
			? urlObj
			: (urlObj as { url?: string })?.url || "";
	const callbackUrl = `${baseUrl}/api/providers/origin/callback`;
	const webhookUrl = `${baseUrl}/api/deploy/origin`;

	const { mutateAsync, error, isError } = api.origin.create.useMutation();
	const { mutateAsync: generateKeypair, isPending: isGenerating } =
		api.origin.generateKeypair.useMutation();

	const form = useForm({
		defaultValues: {
			name: "",
			originAppId: "",
			originPrivateKey: "",
			originPublicKey: "",
		},
		resolver: zodResolver(Schema),
	});

	useEffect(() => {
		form.reset({
			name: "",
			originAppId: "",
			originPrivateKey: "",
			originPublicKey: "",
		});
	}, [form, isOpen]);

	const onSubmit = async (data: Schema) => {
		try {
			await mutateAsync({
				name: data.name,
				originAppId: data.originAppId,
				originPrivateKey: data.originPrivateKey,
				originPublicKey: data.originPublicKey,
				originWebhookUrl: webhookUrl.startsWith("https://")
					? webhookUrl
					: undefined,
			});
			toast.success("Origin provider created. Install it into a codebase.");
			setIsOpen(false);
		} catch (err: unknown) {
			toast.error(
				err instanceof Error ? err.message : "Error creating Origin provider",
			);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button variant="secondary" className="flex items-center space-x-1">
					<OriginIcon />
					<span>Origin</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						Origin Provider <OriginIcon className="size-5" />
					</DialogTitle>
				</DialogHeader>
				{isError && <AlertBlock type="error">{error?.message}</AlertBlock>}
				<Form {...form}>
					<form
						id="hook-form-add-origin"
						onSubmit={form.handleSubmit(onSubmit)}
						className="grid w-full gap-1"
					>
						<CardContent className="p-0">
							<div className="flex flex-col gap-4">
								<p className="text-muted-foreground text-sm">
									Each Dokploy instance registers its own Origin App. The host
									must be reachable over public HTTPS for install and webhooks.
								</p>
								<ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
									<li>
										Generate an Ed25519 keypair below (or paste one you already
										created).
									</li>
									<li className="flex flex-row gap-2 items-center">
										Create an Origin App at{" "}
										<Link
											href="https://cursor.com/codebase/settings/apps"
											target="_blank"
										>
											<ExternalLink className="w-fit text-primary size-4" />
										</Link>
									</li>
									<li>
										Register this public key, callback URL{" "}
										<span className="text-primary">{callbackUrl}</span>, and
										webhook URL{" "}
										<span className="text-primary">{webhookUrl}</span>{" "}
										(subscribe to <code>repository.pushed</code>).
									</li>
									<li>Paste the Origin App ID and private key here.</li>
								</ol>
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Name</FormLabel>
											<FormControl>
												<Input placeholder="my-origin-app" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<div className="flex justify-start">
									<Button
										type="button"
										variant="outline"
										isLoading={isGenerating}
										onClick={async () => {
											const keys = await generateKeypair();
											form.setValue("originPublicKey", keys.publicKey);
											form.setValue("originPrivateKey", keys.privateKey);
											toast.success("Generated Ed25519 keypair");
										}}
									>
										Generate Ed25519 keypair
									</Button>
								</div>
								<FormField
									control={form.control}
									name="originPublicKey"
									render={({ field }) => (
										<FormItem>
											<FormLabel>Public key</FormLabel>
											<FormControl>
												<Textarea
													className="font-mono text-xs"
													rows={4}
													placeholder="-----BEGIN PUBLIC KEY-----"
													{...field}
												/>
											</FormControl>
											<FormDescription>
												Paste this PEM into the Origin App signing key.
											</FormDescription>
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
												<Input placeholder="app_01..." {...field} />
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
													rows={5}
													placeholder="-----BEGIN PRIVATE KEY-----"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<Button isLoading={form.formState.isSubmitting}>
									Save Origin App
								</Button>
							</div>
						</CardContent>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
};
