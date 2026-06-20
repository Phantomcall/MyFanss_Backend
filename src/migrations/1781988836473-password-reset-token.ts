import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class PasswordResetToken1781988836473 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'password_reset_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            isGenerated: true,
          },
          {
            name: 'userId',
            type: 'int',
          },
          {
            name: 'tokenHash',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'expiresAt',
            type: 'timestamp',
          },
          {
            name: 'usedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'password_reset_tokens',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'password_reset_tokens',
      new TableIndex({
        name: 'IDX_PASSWORD_RESET_TOKENS_USER_USED',
        columnNames: ['userId', 'usedAt'],
      }),
    );

    await queryRunner.createIndex(
      'password_reset_tokens',
      new TableIndex({
        name: 'IDX_PASSWORD_RESET_TOKENS_EXPIRES_AT',
        columnNames: ['expiresAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('password_reset_tokens');
  }
}
