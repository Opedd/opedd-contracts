// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title OpeddRegistry
 * @notice On-chain registry of content license proofs for the Opedd Protocol.
 *         Stores hashes (not PII) as immutable proof that a license was issued.
 *         Anyone can verify a license exists without trusting Opedd's servers.
 */
contract OpeddRegistry {

    // ── Types ────────────────────────────────────────────────────────────

    struct LicenseProof {
        bytes32 contentHash;      // SHA-256 of the licensed content
        bytes32 documentHash;     // SHA-256 of the legal license PDF
        uint8   licenseType;      // 1 = human, 2 = ai
        uint8   intendedUse;      // 0 = unspecified, 1 = personal, 2 = editorial,
                                  // 3 = commercial, 4 = ai_training, 5 = corporate
        uint40  issuedAt;         // block timestamp when registered
        address publisher;        // publisher's address (who registered it)
        bool    revoked;          // can be revoked by publisher or admin
    }

    // ── State ────────────────────────────────────────────────────────────

    /// @notice Contract owner (Opedd deployer)
    address public owner;

    /// @notice Addresses authorized to register licenses (Opedd backend)
    mapping(address => bool) public registrars;

    /// @notice License proofs indexed by keccak256(licenseKey)
    mapping(bytes32 => LicenseProof) public proofs;

    /// @notice Total number of licenses registered
    uint256 public totalRegistered;

    /// @notice Total number of licenses revoked
    uint256 public totalRevoked;

    // ── Events ───────────────────────────────────────────────────────────

    event LicenseRegistered(
        bytes32 indexed keyHash,
        bytes32 indexed contentHash,
        address indexed publisher,
        uint8   licenseType,
        uint40  issuedAt
    );

    event LicenseRevoked(
        bytes32 indexed keyHash,
        address indexed revokedBy
    );

    event RegistrarAdded(address indexed registrar);
    event RegistrarRemoved(address indexed registrar);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRegistrar() {
        require(registrars[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        registrars[msg.sender] = true;
    }

    // ── Admin ────────────────────────────────────────────────────────────

    /// @notice Transfer ownership to a new address
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Add an address that can register licenses (Opedd backend wallet)
    function addRegistrar(address registrar) external onlyOwner {
        require(registrar != address(0), "Zero address");
        registrars[registrar] = true;
        emit RegistrarAdded(registrar);
    }

    /// @notice Remove a registrar
    function removeRegistrar(address registrar) external onlyOwner {
        registrars[registrar] = false;
        emit RegistrarRemoved(registrar);
    }

    // ── Core ─────────────────────────────────────────────────────────────

    /// @notice Register a license proof on-chain
    /// @param keyHash       keccak256 hash of the license key (e.g. "OP-7K3M-R9X2")
    /// @param contentHash   SHA-256 hash of the article content
    /// @param documentHash  SHA-256 hash of the legal license document (PDF)
    /// @param licenseType   1 = human, 2 = ai
    /// @param intendedUse   0-5 (see struct definition)
    /// @param publisher     Publisher's identifier address
    function register(
        bytes32 keyHash,
        bytes32 contentHash,
        bytes32 documentHash,
        uint8   licenseType,
        uint8   intendedUse,
        address publisher
    ) external onlyRegistrar {
        require(proofs[keyHash].issuedAt == 0, "Already registered");
        require(licenseType == 1 || licenseType == 2, "Invalid license type");
        require(intendedUse <= 5, "Invalid intended use");

        proofs[keyHash] = LicenseProof({
            contentHash:  contentHash,
            documentHash: documentHash,
            licenseType:  licenseType,
            intendedUse:  intendedUse,
            issuedAt:     uint40(block.timestamp),
            publisher:    publisher,
            revoked:      false
        });

        totalRegistered++;

        emit LicenseRegistered(keyHash, contentHash, publisher, licenseType, uint40(block.timestamp));
    }

    /// @notice Register multiple license proofs in a single transaction (gas efficient)
    /// @param keyHashes      Array of keccak256 hashes of license keys
    /// @param contentHashes  Array of SHA-256 hashes of article content
    /// @param documentHashes Array of SHA-256 hashes of license documents
    /// @param licenseTypes   Array of license types (1=human, 2=ai)
    /// @param intendedUses   Array of intended use codes (0-5)
    /// @param publishers     Array of publisher addresses
    function registerBatch(
        bytes32[] calldata keyHashes,
        bytes32[] calldata contentHashes,
        bytes32[] calldata documentHashes,
        uint8[]   calldata licenseTypes,
        uint8[]   calldata intendedUses,
        address[] calldata publishers
    ) external onlyRegistrar {
        uint256 len = keyHashes.length;
        require(
            len == contentHashes.length &&
            len == documentHashes.length &&
            len == licenseTypes.length &&
            len == intendedUses.length &&
            len == publishers.length,
            "Array length mismatch"
        );
        require(len <= 100, "Batch too large");

        for (uint256 i = 0; i < len; i++) {
            bytes32 keyHash = keyHashes[i];

            // Skip already registered (don't revert the whole batch)
            if (proofs[keyHash].issuedAt != 0) continue;

            require(licenseTypes[i] == 1 || licenseTypes[i] == 2, "Invalid license type");
            require(intendedUses[i] <= 5, "Invalid intended use");

            proofs[keyHash] = LicenseProof({
                contentHash:  contentHashes[i],
                documentHash: documentHashes[i],
                licenseType:  licenseTypes[i],
                intendedUse:  intendedUses[i],
                issuedAt:     uint40(block.timestamp),
                publisher:    publishers[i],
                revoked:      false
            });

            totalRegistered++;

            emit LicenseRegistered(keyHash, contentHashes[i], publishers[i], licenseTypes[i], uint40(block.timestamp));
        }
    }

    /// @notice Revoke a license (publisher or admin only)
    function revoke(bytes32 keyHash) external {
        LicenseProof storage proof = proofs[keyHash];
        require(proof.issuedAt != 0, "License not found");
        require(!proof.revoked, "Already revoked");
        require(
            msg.sender == owner ||
            registrars[msg.sender] ||
            msg.sender == proof.publisher,
            "Not authorized"
        );

        proof.revoked = true;
        totalRevoked++;

        emit LicenseRevoked(keyHash, msg.sender);
    }

    // ── Views ────────────────────────────────────────────────────────────

    /// @notice Verify a license exists and is valid
    /// @param keyHash keccak256 hash of the license key
    /// @return valid       Whether the license exists and is not revoked
    /// @return contentHash Hash of the licensed content
    /// @return documentHash Hash of the legal document
    /// @return licenseType 1=human, 2=ai
    /// @return intendedUse 0-5
    /// @return issuedAt    Timestamp
    /// @return publisher   Publisher address
    function verify(bytes32 keyHash) external view returns (
        bool    valid,
        bytes32 contentHash,
        bytes32 documentHash,
        uint8   licenseType,
        uint8   intendedUse,
        uint40  issuedAt,
        address publisher
    ) {
        LicenseProof memory proof = proofs[keyHash];

        if (proof.issuedAt == 0) {
            return (false, bytes32(0), bytes32(0), 0, 0, 0, address(0));
        }

        return (
            !proof.revoked,
            proof.contentHash,
            proof.documentHash,
            proof.licenseType,
            proof.intendedUse,
            proof.issuedAt,
            proof.publisher
        );
    }

    /// @notice Check if a license key has been registered
    function isRegistered(bytes32 keyHash) external view returns (bool) {
        return proofs[keyHash].issuedAt != 0;
    }

    /// @notice Check if a license is revoked
    function isRevoked(bytes32 keyHash) external view returns (bool) {
        return proofs[keyHash].revoked;
    }
}
