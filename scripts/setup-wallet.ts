import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import dotenv from "dotenv";
import { writeFileSync, existsSync, readFileSync } from "fs";

dotenv.config();

async function main() {
  const cdp = new CdpClient({
    apiKeyId: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  // Create or reuse deployer account
  console.log("Creating deployer account on CDP...");
  const account = await cdp.evm.getOrCreateAccount({ name: "opedd-deployer" });
  console.log("Deployer address:", account.address);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Current balance:", (Number(balance) / 1e18).toFixed(6), "ETH");

  if (balance === 0n) {
    console.log("\nRequesting testnet ETH from faucet...");
    const faucetResp = await cdp.evm.requestFaucet({
      address: account.address,
      network: "base-sepolia",
      token: "eth",
    });
    console.log("Faucet tx:", `https://sepolia.basescan.org/tx/${faucetResp.transactionHash}`);

    // Wait for faucet tx
    await publicClient.waitForTransactionReceipt({ hash: faucetResp.transactionHash });
    const newBalance = await publicClient.getBalance({ address: account.address });
    console.log("New balance:", (Number(newBalance) / 1e18).toFixed(6), "ETH");
  }

  // Export the private key for Hardhat
  console.log("\nExporting private key for Hardhat...");
  const privateKey = await cdp.evm.exportAccount({ address: account.address });

  // Update .env with the deployer private key
  const envPath = new URL("../.env", import.meta.url).pathname;
  let envContent = readFileSync(envPath, "utf-8");

  if (envContent.includes("DEPLOYER_PRIVATE_KEY=")) {
    envContent = envContent.replace(/DEPLOYER_PRIVATE_KEY=.*/, `DEPLOYER_PRIVATE_KEY=${privateKey}`);
  } else {
    envContent += `\nDEPLOYER_PRIVATE_KEY=${privateKey}\nBASE_SEPOLIA_RPC=https://sepolia.base.org\n`;
  }

  writeFileSync(envPath, envContent);
  console.log("Private key saved to .env");

  console.log("\n--- Ready to deploy ---");
  console.log("Run: npm run deploy:testnet");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message || error);
    process.exit(1);
  });
