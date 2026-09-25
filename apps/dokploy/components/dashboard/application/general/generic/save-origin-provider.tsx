import type { OriginRepository } from "@dokploy/server";
import { VALID_BRANCH_REGEX } from "@dokploy/server/utils/git-branch-validation";
import { standardSchemaResolver as zodResolver } from "@hookform/resolvers/standard-schema";
import { CheckIcon, ChevronsUpDown, HelpCircle, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { OriginIcon } from "@/components/icons/data-tools-icons";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
} from "@/components/ui/command";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";

interface OriginBranch {
	name: string;
	commit?: {
		sha: string;
	};
}

const OriginProviderSchema = z.object({
	buildPath: z.string().min(1, "Path is required").default("/"),
	repository: z
		.object({
			repo: z.string().min(1, "Repo is required"),
			owner: z.string().min(1, "Owner is required"),
		})
		.required(),
	branch: z
		.string()
		.min(1, "Branch is required")
		.regex(VALID_BRANCH_REGEX, "Invalid branch name"),
	originId: z.string().min(1, "Origin Provider is required"),
	watchPaths: z.array(z.string()).default([]),
	enableSubmodules: z.boolean().optional(),
});

type OriginProvider = z.infer<typeof OriginProviderSchema>;

interface Props {
	applicationId: string;
}

export const SaveOriginProvider = ({ applicationId }: Props) => {
	const { data: originProviders } = api.origin.originProviders.useQuery();
	const { data, refetch } = api.application.one.useQuery({ applicationId });

	const { mutateAsync, isPending: isSavingOriginProvider } =
		api.application.saveOriginProvider.useMutation();

	const form = useForm({
		defaultValues: {
			buildPath: "/",
			repository: {
				owner: "",
				repo: "",
			},
			originId: "",
			branch: "",
			watchPaths: [],
			enableSubmodules: false,
		},
		resolver: zodResolver(OriginProviderSchema),
	});

	const repository = form.watch("repository");
	const originId = form.watch("originId");

	const originUrl = "https://origin.cursor.com";

	const {
		data: repositories,
		isLoading: isLoadingRepositories,
		error,
	} = api.origin.getOriginRepositories.useQuery(
		{
			originId,
		},
		{
			enabled: !!originId,
		},
	);

	const {
		data: branches,
		fetchStatus,
		status,
	} = api.origin.getOriginBranches.useQuery(
		{
			owner: repository?.owner,
			repo: repository?.repo,
			originId: originId,
		},
		{
			enabled: !!repository?.owner && !!repository?.repo && !!originId,
		},
	);

	useEffect(() => {
		if (data) {
			form.reset({
				branch: data.originBranch || "",
				repository: {
					repo: data.originRepository || "",
					owner: data.originOwner || "",
				},
				buildPath: data.originBuildPath || "/",
				originId: data.originId || "",
				watchPaths: data.watchPaths || [],
				enableSubmodules: data.enableSubmodules || false,
			});
		}
	}, [form.reset, data?.applicationId, form]);

	const onSubmit = async (data: OriginProvider) => {
		await mutateAsync({
			originBranch: data.branch,
			originRepository: data.repository.repo,
			originOwner: data.repository.owner,
			originBuildPath: data.buildPath,
			originId: data.originId,
			applicationId,
			watchPaths: data.watchPaths,
			enableSubmodules: data.enableSubmodules || false,
		})
			.then(async () => {
				toast.success("Service Provider Saved");
				await refetch();
			})
			.catch(() => {
				toast.error("Error saving the Origin provider");
			});
	};

	return (
		<div>
			<Form {...form}>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="grid w-full gap-4 py-3"
				>
					{error && <AlertBlock type="error">{error?.message}</AlertBlock>}
					<div className="grid md:grid-cols-2 gap-4">
						<FormField
							control={form.control}
							name="originId"
							render={({ field }) => (
								<FormItem className="md:col-span-2 flex flex-col">
									<FormLabel>Origin Account</FormLabel>
									<Select
										onValueChange={(value) => {
											if (!value) {
												return;
											}
											field.onChange(value);
											form.setValue("repository", {
												owner: "",
												repo: "",
											});
											form.setValue("branch", "");
										}}
										value={field.value}
									>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Select a Origin Account" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{originProviders?.map((originProvider) => (
												<SelectItem
													key={originProvider.originId}
													value={originProvider.originId}
												>
													{originProvider.gitProvider.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="repository"
							render={({ field }) => (
								<FormItem className="md:col-span-2 flex flex-col">
									<div className="flex items-center justify-between">
										<FormLabel>Repository</FormLabel>
										{field.value.owner && field.value.repo && (
											<Link
												href={`${originUrl}/${field.value.owner}/${field.value.repo}`}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
											>
												<OriginIcon className="h-4 w-4" />
												<span>View Repository</span>
											</Link>
										)}
									</div>

									<Popover>
										<PopoverTrigger asChild>
											<FormControl>
												<Button
													variant="outline"
													className={cn(
														"w-full justify-between",
														!field.value && "text-muted-foreground",
													)}
												>
													{!field.value.owner
														? "Select repository"
														: isLoadingRepositories
															? "Loading...."
															: (repositories?.find(
																	(repo: OriginRepository) =>
																		repo.name === field.value.repo &&
																		repo.owner.slug === field.value.owner,
																)?.name ?? "Select repository")}

													<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
												</Button>
											</FormControl>
										</PopoverTrigger>
										<PopoverContent
											className="w-[var(--radix-popover-trigger-width)] p-0"
											align="start"
										>
											<Command>
												<CommandInput
													placeholder="Search repository..."
													className="h-9"
												/>
												{!originId ? (
													<span className="py-6 text-center text-sm text-muted-foreground">
														Select a Origin account first
													</span>
												) : isLoadingRepositories ? (
													<span className="py-6 text-center text-sm">
														Loading Repositories....
													</span>
												) : null}
												<CommandEmpty>No repositories found.</CommandEmpty>
												<ScrollArea className="h-96">
													<CommandGroup>
														{repositories && repositories.length === 0 && (
															<CommandEmpty>
																No repositories found.
															</CommandEmpty>
														)}
														{repositories?.map((repo: OriginRepository) => {
															return (
																<CommandItem
																	value={`${repo.owner.slug}/${repo.name}`}
																	key={repo.id}
																	onSelect={() => {
																		form.setValue("repository", {
																			owner: repo.owner.slug as string,
																			repo: repo.name,
																		});
																		form.setValue("branch", "");
																	}}
																>
																	<span className="flex min-w-0 items-center gap-2">
																		<span className="truncate">
																			{repo.name}
																		</span>
																		<span className="text-muted-foreground text-xs">
																			{repo.owner.slug}
																		</span>
																	</span>
																	<CheckIcon
																		className={cn(
																			"ml-auto h-4 w-4",
																			repo.name === field.value.repo &&
																				repo.owner.slug === field.value.owner
																				? "opacity-100"
																				: "opacity-0",
																		)}
																	/>
																</CommandItem>
															);
														})}
													</CommandGroup>
												</ScrollArea>
											</Command>
										</PopoverContent>
									</Popover>
									{form.formState.errors.repository && (
										<p className={cn("text-sm font-medium text-destructive")}>
											Repository is required
										</p>
									)}
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="branch"
							render={({ field }) => (
								<FormItem className="block w-full">
									<FormLabel>Branch</FormLabel>
									<Popover>
										<PopoverTrigger asChild>
											<FormControl>
												<Button
													variant="outline"
													className={cn(
														" w-full justify-between",
														!field.value && "text-muted-foreground",
													)}
												>
													{status === "pending" && fetchStatus === "fetching"
														? "Loading...."
														: field.value
															? branches?.find(
																	(branch: OriginBranch) =>
																		branch.name === field.value,
																)?.name
															: "Select branch"}
													<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
												</Button>
											</FormControl>
										</PopoverTrigger>
										<PopoverContent
											className="w-[var(--radix-popover-trigger-width)] p-0"
											align="start"
										>
											<Command>
												<CommandInput
													placeholder="Search branch..."
													className="h-9"
												/>
												{status === "pending" && fetchStatus === "fetching" && (
													<span className="py-6 text-center text-sm text-muted-foreground">
														Loading Branches....
													</span>
												)}
												{!repository?.owner && (
													<span className="py-6 text-center text-sm text-muted-foreground">
														Select a repository
													</span>
												)}
												<ScrollArea className="h-96">
													<CommandEmpty>No branch found.</CommandEmpty>

													<CommandGroup>
														{branches && branches.length === 0 && (
															<CommandItem>No branches found.</CommandItem>
														)}
														{branches?.map((branch: OriginBranch) => (
															<CommandItem
																value={branch.name}
																key={branch.name}
																onSelect={() => {
																	form.setValue("branch", branch.name);
																}}
															>
																<span className="truncate">{branch.name}</span>
																<CheckIcon
																	className={cn(
																		"ml-auto h-4 w-4",
																		branch.name === field.value
																			? "opacity-100"
																			: "opacity-0",
																	)}
																/>
															</CommandItem>
														))}
													</CommandGroup>
												</ScrollArea>
											</Command>
										</PopoverContent>

										<FormMessage />
									</Popover>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="buildPath"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Build Path</FormLabel>
									<FormControl>
										<Input placeholder="/" {...field} />
									</FormControl>

									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="watchPaths"
							render={({ field }) => (
								<FormItem className="md:col-span-2">
									<div className="flex items-center gap-2">
										<FormLabel>Watch Paths</FormLabel>
										<TooltipProvider>
											<Tooltip>
												<TooltipTrigger asChild>
													<HelpCircle className="size-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
												</TooltipTrigger>
												<TooltipContent>
													<p>
														Add paths to watch for changes. When files in these
														paths change, a new deployment will be triggered.
													</p>
												</TooltipContent>
											</Tooltip>
										</TooltipProvider>
									</div>
									<div className="flex flex-wrap gap-2 mb-2">
										{field.value?.map((path: string, index: number) => (
											<Badge
												key={index}
												variant="secondary"
												className="flex items-center gap-1"
											>
												{path}
												<button
													type="button"
													aria-label="Remove watch path"
													className="inline-flex items-center focus-visible:ring-2"
													onClick={() => {
														const newPaths = [...(field.value || [])];
														newPaths.splice(index, 1);
														field.onChange(newPaths);
													}}
												>
													<X className="size-3 cursor-pointer hover:text-destructive" />
												</button>
											</Badge>
										))}
									</div>
									<div className="flex gap-2">
										<FormControl>
											<Input
												placeholder="Enter a path to watch (e.g., src/**, dist/*.js)"
												onKeyDown={(e) => {
													if (e.key === "Enter") {
														e.preventDefault();
														const input = e.currentTarget;
														const path = input.value.trim();
														if (path) {
															field.onChange([...(field.value || []), path]);
															input.value = "";
														}
													}
												}}
											/>
										</FormControl>
										<Button
											type="button"
											variant="outline"
											size="icon"
											onClick={() => {
												const input = document.querySelector(
													'input[placeholder*="Enter a path"]',
												) as HTMLInputElement;
												const path = input.value.trim();
												if (path) {
													field.onChange([...(field.value || []), path]);
													input.value = "";
												}
											}}
										>
											<Plus className="size-4" />
										</Button>
									</div>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="enableSubmodules"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center space-x-2 space-y-0">
									<FormControl>
										<Switch
											checked={field.value}
											onCheckedChange={field.onChange}
										/>
									</FormControl>
									<FormLabel>Enable Submodules</FormLabel>
								</FormItem>
							)}
						/>
					</div>
					<div className="flex w-full justify-end">
						<Button
							isLoading={isSavingOriginProvider}
							type="submit"
							className="w-fit"
						>
							Save
						</Button>
					</div>
				</form>
			</Form>
		</div>
	);
};
