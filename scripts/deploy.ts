import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("Deploying OpeddRegistry with account:", deployer.account.address);

  const publicClient = await connection.viem.getPublicClient();
  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log("Account balance:", (Number(balance) / 1e18).toFixed(6), "ETH");

  const registry = await connection.viem.deployContract("OpeddRegistry");
  const address = registry.address;

  console.log("OpeddRegistry deployed to:", address);
  console.log("Owner:", await registry.read.owner());
  console.log("Total registered:", (await registry.read.totalRegistered()).toString());

  console.log("\n--- Add to your .env ---");
  console.log(`REGISTRY_CONTRACT_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
