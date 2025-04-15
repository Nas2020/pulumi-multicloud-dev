import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface ControllerConfigOutputs {
    configBucket: pulumi.Output<string>;
    configObjectKey: pulumi.Output<string>;
}

export function createControllerConfig(): ControllerConfigOutputs {
    const environment = pulumi.getStack();
    
    // Create S3 bucket for non-sensitive configuration
    const configBucket = new aws.s3.Bucket("controller-config", {
        bucket: `controller-config-${environment}-${pulumi.getOrganization()}-${pulumi.getProject()}`,
        acl: "private",
        versioning: {
            enabled: true,
        },
        tags: {
            Name: `controller-config-${environment}`,
            Environment: environment,
            Service: "cape-fear-controller"
        },
    });
    
    // Create configuration template
    const configTemplate = `
    # Application configuration
    SCHOOL="Your School Name"
    SCHOOL_WELCOME_MESSAGE="Welcome message for your school"
    ISSUE_STUDENT_ID_MESSAGE="Message for student ID issuance"
    ISSUE_STUDENT_TRANSCRIPT_MESSAGE="Message for transcript issuance"
    REQUEST_STUDENT_ID_VERIFICATION_MESSAGE="Message for student ID verification"
    REQUEST_STUDENT_TRANSCRIPT_VERIFICATION_MESSAGE="Message for transcript verification"

    # Schema and credential definition IDs
    ID_SCHEMA_NAME="US State College Student ID"
    TRANSCRIPT_SCHEMA_NAME="US State College Transcript"
    TRANSCRIPT_CREDENTIAL_DEFINITION_ID="2biyghqv71MeHTZwpXw6fF:3:CL:99:state-college-transcript-pulumi"
    STUDENTID_CREDENTIAL_DEFINITION_ID="2biyghqv71MeHTZwpXw6fF:3:CL:100:state-college-student-id-pulumi"
    NEW_ORIENTATION_CRED_DEF_ID="2biyghqv71MeHTZwpXw6fF:3:CL:295:state-college-new-student-orientation-pulumi"
    STUDENTID_EXPIRATION="20250101"

    # Ellucian integration
    ELLUCIAN_BASE_API_URL=https://integrate.elluciancloud.com
    ELLUCIAN_PERSON_API_ROUTE=/api/persons
    ELLUCIAN_TRANSCRIPT_API_ROUTE=/api/student-transcript-grades
    ELLUCIAN_GRADE_POINT_AVERAGE_API_ROUTE=/api/student-grade-point-averages
    ELLUCIAN_STUDENT_API_ROUTE=/api/students
    ELLUCIAN_SECTIONS_API_ROUTE=/api/sections
    ELLUCIAN_COURSES_API_ROUTE=/api/courses
    ELLUCIAN_ACADEMIC_PERIOD_API_ROUTE=/api/academic-periods
    ELLUCIAN_ACADEMIC_GRADE_DEF_API_ROUTE=/api/grade-definitions
    ELLUCIAN_AUTH_ROUTE=/auth
    
    # Application server config
    PORT=3008

    # API configuration
    # API_BASE_URL=http://__PUBLIC_IP__
    API_BASE_URL=https://aws-pulumi.digicred.services
    SWAGGER_API_URL=https://aws-pulumi.digicred.services
    
    # Redis configuration
    REDIS_HOST=redis
    REDIS_PORT=6379
    REDIS_DB=0
    REDIS_PORT_EXTERNAL=6380

    # PostgreSQL configuration for Workflow DB
    WORKFLOW_DB_USER=postgres
    WORKFLOW_DB_HOST=postgres
    WORKFLOW_DB_PORT=5432
    WORKFLOW_DB_NAME=cape_fear_workflow_db
    WORKFLOW_DB_PORT_EXTERNAL=5435
    `;
    
    // Upload the config template to S3
    const configObject = new aws.s3.BucketObject("controller-config-template", {
        bucket: configBucket.id,
        key: `${environment}/config-template.env`,
        content: configTemplate,
        contentType: "text/plain",
    });
    
    return {
        configBucket: configBucket.bucket,
        configObjectKey: configObject.key,
    };
}