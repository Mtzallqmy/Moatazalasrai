import {
  consumeExecutionCredentialGrant,
  issueExecutionCredentialGrant,
  revokeExecutionCredentialGrants,
} from "@/lib/execution/credential-grant-service";

export type IssueCredentialGrantInput = Parameters<typeof issueExecutionCredentialGrant>[0];
export type ConsumeCredentialGrantInput = Parameters<typeof consumeExecutionCredentialGrant>[0];

/**
 * Shared credential boundary for isolated execution workspaces.
 * Raw provider secrets never cross this interface; workspaces receive only short-lived one-use grant tokens.
 */
export class CredentialBroker {
  issue(input: IssueCredentialGrantInput) {
    return issueExecutionCredentialGrant(input);
  }

  consume(input: ConsumeCredentialGrantInput) {
    return consumeExecutionCredentialGrant(input);
  }

  revokeJob(input: { organizationId: string; jobId: string }) {
    return revokeExecutionCredentialGrants(input);
  }
}

export const credentialBroker = new CredentialBroker();
