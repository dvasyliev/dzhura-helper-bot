let owner: number | undefined;

/** Who the bot answers: set once by the entry from the settings. */
export function setOwnerId(id: number): void {
  owner = id;
}

export function ownerId(): number {
  if (owner === undefined) throw new Error("The owner is not set");
  return owner;
}
