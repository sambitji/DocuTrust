/**
 * Committed demo fixture: extracted fields for the three document types.
 * Field names are the frozen contract with the rule engine.
 */
const MOCK_EXTRACTED = {
  part1: {
    institution_name: 'Sri Venkateswara Institute of Technology',
    society_name: 'Sri Venkateswara Educational Society',
    address: 'Survey No. 45/2, Outer Ring Road, Hyderabad - 500075',
    district: 'Hyderabad',
    state: 'Telangana',
    area_type: 'metro',
    land_area_sqm: '7284',
    builtup_area_sqm: '8500',
    program_count: '7',
    total_intake: '840',
    course_list: 'CSE:120, ECE:120, ME:120, CE:120, EEE:120, IT:120, AIML:120',
  },
  land: {
    owner_name: 'Sri Venkateshwara Educational Society',
    institution_name: 'Sri Venkateshwara Institute of Technology',
    plot_area_sqm: '7284',
    survey_no: '45/2',
    village: 'Hyderabad',
    district: 'Hyderabad',
    registration_date: '2023-11-20',
    lease_term_years: '99',
  },
  faculty: {
    total_faculty: '42',
    principal_name: 'Dr. R. Venkatesan',
    principal_qualification: 'Ph.D.',
    principal_experience_years: '18',
    principal_professor_years: '6',
    dept_faculty_count: 'CSE:8, ECE:7, ME:7, CE:6, EEE:6, IT:5, AIML:3',
  },
};

export default MOCK_EXTRACTED;
