import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiError } from '../common/api-error';
import { BusinessRule } from '../entities';

@Injectable()
export class BusinessRulesService {
  constructor(
    @InjectRepository(BusinessRule) private rules: Repository<BusinessRule>
  ) {}

  // Get all active business rules
  async getAllRules() {
    const rules = await this.rules.find({
      where: { is_active: true },
      order: { rule_key: 'ASC' }
    });

    return {
      rules: rules.map(r => ({
        rule_id: r.id,
        rule_key: r.rule_key,
        rule_value: this.parseValue(r.rule_value, r.value_type),
        value_type: r.value_type,
        effective_from: r.effective_from,
        effective_to: r.effective_to
      }))
    };
  }

  // Get specific rule by key
  async getRuleByKey(key: string) {
    const rule = await this.rules.findOne({
      where: { rule_key: key, is_active: true }
    });

    if (!rule) {
      throw new ApiError('RULE_NOT_FOUND', `Rule ${key} not found`, HttpStatus.NOT_FOUND);
    }

    return {
      rule_id: rule.id,
      rule_key: rule.rule_key,
      rule_value: this.parseValue(rule.rule_value, rule.value_type),
      value_type: rule.value_type,
      effective_from: rule.effective_from,
      effective_to: rule.effective_to
    };
  }

  // Update business rule (admin only)
  async updateRule(key: string, newValue: any, valueType: string = 'string', createdBy: string = 'admin') {
    const existingRule = await this.rules.findOne({
      where: { rule_key: key, is_active: true }
    });

    if (!existingRule) {
      throw new ApiError('RULE_NOT_FOUND', `Rule ${key} not found`, HttpStatus.NOT_FOUND);
    }

    // Deactivate old rule
    await this.rules.update(existingRule.id, { is_active: false, effective_to: new Date() });

    // Create new rule version
    const newRule = await this.rules.save({
      rule_key: key,
      rule_value: String(newValue),
      value_type: valueType,
      is_active: true,
      created_by: createdBy,
      effective_from: new Date()
    });

    return {
      rule_id: newRule.id,
      rule_key: newRule.rule_key,
      rule_value: this.parseValue(newRule.rule_value, newRule.value_type),
      value_type: newRule.value_type,
      effective_from: newRule.effective_from,
      message: `Rule ${key} updated successfully`
    };
  }

  // Create new rule
  async createRule(key: string, value: any, valueType: string = 'string', createdBy: string = 'admin') {
    const existing = await this.rules.findOne({
      where: { rule_key: key, is_active: true }
    });

    if (existing) {
      throw new ApiError('RULE_ALREADY_EXISTS', `Rule ${key} already exists`, HttpStatus.CONFLICT);
    }

    const rule = await this.rules.save({
      rule_key: key,
      rule_value: String(value),
      value_type: valueType,
      is_active: true,
      created_by: createdBy
    });

    return {
      rule_id: rule.id,
      rule_key: rule.rule_key,
      rule_value: this.parseValue(rule.rule_value, rule.value_type),
      value_type: rule.value_type,
      created_at: rule.created_at
    };
  }

  // Helper: Parse value based on type
  private parseValue(value: string, type: string): any {
    switch (type) {
      case 'int':
        return parseInt(value, 10);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'json':
        return JSON.parse(value);
      default:
        return value;
    }
  }
}
