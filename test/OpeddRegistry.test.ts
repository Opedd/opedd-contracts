import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, toHex, getAddress, zeroAddress } from "viem";

describe("OpeddRegistry", function () {
  const licenseKeyHash = keccak256(toHex("OP-7K3M-R9X2"));
  const contentHash = keccak256(toHex("article content here"));
  const documentHash = keccak256(toHex("legal document pdf bytes"));

  async function deploy() {
    const connection = await hre.network.connect();
    const [owner, registrar, other] = await connection.viem.getWalletClients();
    const registry = await connection.viem.deployContract("OpeddRegistry");
    return { connection, registry, owner, registrar, other };
  }

  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      const { registry, owner } = await deploy();
      const contractOwner = await registry.read.owner();
      assert.equal(getAddress(contractOwner), getAddress(owner.account.address));
    });

    it("owner is a registrar by default", async function () {
      const { registry, owner } = await deploy();
      const isRegistrar = await registry.read.registrars([owner.account.address]);
      assert.equal(isRegistrar, true);
    });

    it("starts with zero registrations", async function () {
      const { registry } = await deploy();
      const total = await registry.read.totalRegistered();
      assert.equal(total, 0n);
    });
  });

  describe("Registrar management", function () {
    it("owner can add a registrar", async function () {
      const { registry, registrar } = await deploy();
      await registry.write.addRegistrar([registrar.account.address]);
      const isRegistrar = await registry.read.registrars([registrar.account.address]);
      assert.equal(isRegistrar, true);
    });

    it("owner can remove a registrar", async function () {
      const { registry, registrar } = await deploy();
      await registry.write.addRegistrar([registrar.account.address]);
      await registry.write.removeRegistrar([registrar.account.address]);
      const isRegistrar = await registry.read.registrars([registrar.account.address]);
      assert.equal(isRegistrar, false);
    });

    it("non-owner cannot add registrar", async function () {
      const { connection, registry, registrar, other } = await deploy();
      const asOther = await connection.viem.getContractAt("OpeddRegistry", registry.address, { client: { wallet: other } });
      await assert.rejects(
        () => asOther.write.addRegistrar([registrar.account.address]),
        /Not owner/
      );
    });

    it("rejects zero address registrar", async function () {
      const { registry } = await deploy();
      await assert.rejects(
        () => registry.write.addRegistrar([zeroAddress]),
        /Zero address/
      );
    });
  });

  describe("Registration", function () {
    it("registrar can register a license", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 3, owner.account.address]);
      assert.equal(await registry.read.totalRegistered(), 1n);
      assert.equal(await registry.read.isRegistered([licenseKeyHash]), true);
    });

    it("stores correct proof data", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 2, 4, owner.account.address]);

      const [valid, cHash, dHash, lType, iUse, issuedAt, pub] = await registry.read.verify([licenseKeyHash]);

      assert.equal(valid, true);
      assert.equal(cHash, contentHash);
      assert.equal(dHash, documentHash);
      assert.equal(lType, 2);
      assert.equal(iUse, 4);
      assert.ok(issuedAt > 0n);
      assert.equal(getAddress(pub), getAddress(owner.account.address));
    });

    it("prevents duplicate registration", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      await assert.rejects(
        () => registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]),
        /Already registered/
      );
    });

    it("rejects invalid license type", async function () {
      const { registry, owner } = await deploy();
      await assert.rejects(
        () => registry.write.register([licenseKeyHash, contentHash, documentHash, 3, 0, owner.account.address]),
        /Invalid license type/
      );
    });

    it("rejects invalid intended use", async function () {
      const { registry, owner } = await deploy();
      await assert.rejects(
        () => registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 6, owner.account.address]),
        /Invalid intended use/
      );
    });

    it("non-registrar cannot register", async function () {
      const { connection, registry, other } = await deploy();
      const asOther = await connection.viem.getContractAt("OpeddRegistry", registry.address, { client: { wallet: other } });
      await assert.rejects(
        () => asOther.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, other.account.address]),
        /Not authorized/
      );
    });

    it("added registrar can register", async function () {
      const { connection, registry, registrar } = await deploy();
      await registry.write.addRegistrar([registrar.account.address]);
      const asRegistrar = await connection.viem.getContractAt("OpeddRegistry", registry.address, { client: { wallet: registrar } });
      await asRegistrar.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, registrar.account.address]);
      assert.equal(await registry.read.isRegistered([licenseKeyHash]), true);
    });
  });

  describe("Batch registration", function () {
    it("registers multiple licenses in one transaction", async function () {
      const { registry, owner } = await deploy();
      const key1 = keccak256(toHex("OP-AAAA-BBBB"));
      const key2 = keccak256(toHex("OP-CCCC-DDDD"));
      const key3 = keccak256(toHex("OP-EEEE-FFFF"));

      await registry.write.registerBatch([
        [key1, key2, key3],
        [contentHash, contentHash, contentHash],
        [documentHash, documentHash, documentHash],
        [1, 2, 1],
        [0, 4, 2],
        [owner.account.address, owner.account.address, owner.account.address],
      ]);

      assert.equal(await registry.read.totalRegistered(), 3n);
      assert.equal(await registry.read.isRegistered([key1]), true);
      assert.equal(await registry.read.isRegistered([key2]), true);
      assert.equal(await registry.read.isRegistered([key3]), true);
    });

    it("skips duplicates in batch without reverting", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);

      const key2 = keccak256(toHex("OP-NEW1-KEY1"));
      await registry.write.registerBatch([
        [licenseKeyHash, key2],
        [contentHash, contentHash],
        [documentHash, documentHash],
        [1, 2],
        [0, 0],
        [owner.account.address, owner.account.address],
      ]);

      assert.equal(await registry.read.totalRegistered(), 2n);
    });

    it("rejects mismatched array lengths", async function () {
      const { registry, owner } = await deploy();
      await assert.rejects(
        () => registry.write.registerBatch([
          [licenseKeyHash],
          [contentHash, contentHash],
          [documentHash],
          [1],
          [0],
          [owner.account.address],
        ]),
        /Array length mismatch/
      );
    });
  });

  describe("Verification", function () {
    it("returns valid=false for unregistered key", async function () {
      const { registry } = await deploy();
      const fakeKey = keccak256(toHex("OP-FAKE-KEY1"));
      const [valid] = await registry.read.verify([fakeKey]);
      assert.equal(valid, false);
    });

    it("returns valid=true for registered key", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      const [valid] = await registry.read.verify([licenseKeyHash]);
      assert.equal(valid, true);
    });

    it("returns valid=false for revoked key", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      await registry.write.revoke([licenseKeyHash]);
      const [valid] = await registry.read.verify([licenseKeyHash]);
      assert.equal(valid, false);
    });
  });

  describe("Revocation", function () {
    it("owner can revoke", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      await registry.write.revoke([licenseKeyHash]);
      assert.equal(await registry.read.isRevoked([licenseKeyHash]), true);
      assert.equal(await registry.read.totalRevoked(), 1n);
    });

    it("unauthorized user cannot revoke", async function () {
      const { connection, registry, owner, other } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      const asOther = await connection.viem.getContractAt("OpeddRegistry", registry.address, { client: { wallet: other } });
      await assert.rejects(
        () => asOther.write.revoke([licenseKeyHash]),
        /Not authorized/
      );
    });

    it("cannot revoke non-existent license", async function () {
      const { registry } = await deploy();
      const fakeKey = keccak256(toHex("OP-NOPE-NOPE"));
      await assert.rejects(
        () => registry.write.revoke([fakeKey]),
        /License not found/
      );
    });

    it("cannot revoke twice", async function () {
      const { registry, owner } = await deploy();
      await registry.write.register([licenseKeyHash, contentHash, documentHash, 1, 0, owner.account.address]);
      await registry.write.revoke([licenseKeyHash]);
      await assert.rejects(
        () => registry.write.revoke([licenseKeyHash]),
        /Already revoked/
      );
    });
  });

  describe("Ownership", function () {
    it("owner can transfer ownership", async function () {
      const { registry, other } = await deploy();
      await registry.write.transferOwnership([other.account.address]);
      const newOwner = await registry.read.owner();
      assert.equal(getAddress(newOwner), getAddress(other.account.address));
    });

    it("non-owner cannot transfer", async function () {
      const { connection, registry, other } = await deploy();
      const asOther = await connection.viem.getContractAt("OpeddRegistry", registry.address, { client: { wallet: other } });
      await assert.rejects(
        () => asOther.write.transferOwnership([other.account.address]),
        /Not owner/
      );
    });

    it("cannot transfer to zero address", async function () {
      const { registry } = await deploy();
      await assert.rejects(
        () => registry.write.transferOwnership([zeroAddress]),
        /Zero address/
      );
    });
  });
});
